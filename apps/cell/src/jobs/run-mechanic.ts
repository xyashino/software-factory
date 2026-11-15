import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CommandResult } from '@repo/factory-core/contracts/cell';
import type { FactoryClient } from '@repo/factory-core/contracts/client';
import type { Job } from '@repo/factory-core/contracts/job';
import type {
  OperatorReply,
  OperatorRequest,
} from '@repo/factory-core/contracts/operator';
import type { CellId } from '@repo/factory-core/ids';
import type { OrderCommand } from '@repo/factory-core/order/commands';
import { getRunner } from '../adapters/runners/registry';
import { paneName } from '../names';
import { newCycleToken, startOperatorSocket } from '../operator-socket';
import type { PaneDriver } from '../ports';
import { getBlob } from './blobs';
import { orderIdOf } from './job-shape';

/** What the Mechanic is told to do when its incident says `nudge` (CORE §14.3). */
export const MECHANIC_NUDGE =
  'Continue the task and finish with the factory-operator command it names.';

export interface MechanicDeps {
  client: FactoryClient;
  cellId: CellId;
  dataDir: string;
  /** The Herdr pane the Mechanic runs in (PROTOCOL §9). A Mechanic job never runs headless. */
  pane: PaneDriver;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  tickMs: number;
  signal?: AbortSignal;
}

type Submit = (
  step: string,
  command: OrderCommand,
) => Promise<
  | { ok: true; result: CommandResult }
  | { ok: false; code: string; message: string }
>;

/**
 * The repair checkout of one Mechanic job: a scratch directory under the Cell's data dir, named by a hash
 * so the operator socket path stays short. It is never a Work order worktree (CORE §14.3).
 */
const repairDirOf = (dataDir: string, jobId: string): string =>
  join(
    dataDir,
    'repairs',
    createHash('sha256').update(jobId).digest('hex').slice(0, 16),
  );

/**
 * Runs one Mechanic job (CORE §14.4): the incident prompt in a Herdr pane, with its working directory the
 * repair checkout. The Mechanic's socket takes two verbs only, `incident` and `escalate`; each one is
 * submitted as a `RecordIncident` under the Mechanic's actor and the job's epoch. The incident ends the
 * job; a `resume`, `repair` or `cancel` action then clears the Andon with the Mechanic's own command.
 *
 * With no incident before the Mechanic exits or its time runs out, nothing is submitted: the lease lapses,
 * and the reaper counts the run against the Mechanic budget (CORE §14.5).
 */
export const runMechanic = async (
  job: Job,
  deps: MechanicDeps,
): Promise<Job | null> => {
  const mechanic = job.mechanic;
  if (mechanic === undefined) {
    throw new Error(`job ${job.jobId} is not a mechanic job`);
  }
  const orderId = orderIdOf(job);
  const operator = mechanic.operator;
  const adapter = getRunner(operator.runner);
  if (adapter === undefined) {
    throw new Error(`no adapter for runner ${operator.runner}`);
  }

  const repairDir = repairDirOf(deps.dataDir, job.jobId);
  mkdirSync(repairDir, { recursive: true });
  const promptPath = join(repairDir, 'prompt.md');
  writeFileSync(promptPath, await getBlob(deps.client, mechanic.promptBlob));
  const token = newCycleToken();
  const socketPath = join(repairDir, 'op.sock');
  const name = paneName('mechanic', mechanic.n, job.jobId);
  const kickoff = `Read ${promptPath} and follow it exactly. Finish with the factory-operator command it names.`;

  let ending: { next: Job | null } | undefined;

  const submit: Submit = async (step, command) => {
    if (deps.signal?.aborted) {
      return {
        ok: false,
        code: 'stopped',
        message: String(deps.signal.reason),
      };
    }
    try {
      const result: CommandResult = await deps.client.call('submitCommand', {
        cellId: deps.cellId,
        jobId: job.jobId,
        orderId: job.orderId,
        commandId: `${job.jobId}:${step}`,
        epoch: job.epoch,
        command,
      });
      return { ok: true, result };
    } catch (error) {
      const wire = (error as { error?: { code: string; detail?: string } })
        .error;
      if (wire === undefined) throw error;
      return { ok: false, code: wire.code, message: wire.detail ?? wire.code };
    }
  };

  /** Records the incident, then runs the follow-up its action names. The incident ends the job. */
  const recordIncident = async (
    req: Extract<OperatorRequest, { op: 'incident' | 'escalate' }>,
  ): Promise<OperatorReply> => {
    const incident: OrderCommand =
      req.op === 'incident'
        ? {
            type: 'RecordIncident',
            diagnosis: req.diagnosis,
            action: { kind: req.action },
            changes: req.changes,
            outcome: req.outcome,
          }
        : {
            type: 'RecordIncident',
            diagnosis: req.diagnosis,
            action: { kind: 'escalate' },
            changes: [],
            outcome: req.outcome,
          };
    const recorded = await submit(req.op, incident);
    if (!recorded.ok) {
      return { ok: false, code: 'rejected', message: recorded.message };
    }
    let next = recorded.result.next;
    // A repair puts the workflow right, so the Work order goes on as a resume (CORE §14.3).
    const follow: OrderCommand | undefined =
      req.op === 'escalate'
        ? undefined
        : req.action === 'resume' || req.action === 'repair'
          ? { type: 'Resume', mode: { kind: 'retry_station' } }
          : req.action === 'cancel'
            ? { type: 'Cancel', reason: req.outcome }
            : req.action === 'nudge'
              ? { type: 'Nudge', text: MECHANIC_NUDGE }
              : undefined;
    if (follow !== undefined) {
      const done = await submit(follow.type.toLowerCase(), follow);
      if (!done.ok) {
        ending = { next };
        return {
          ok: false,
          code: 'rejected',
          message: `the incident is recorded; its follow-up was refused: ${done.message}`,
        };
      }
      next = done.result.next;
    }
    ending = { next };
    return { ok: true };
  };

  /** The Mechanic's verbs only: anything else is refused, and no command is sent for it. */
  const dispatch = async (req: OperatorRequest): Promise<OperatorReply> => {
    if (ending !== undefined || deps.signal?.aborted) {
      return {
        ok: false,
        code: 'not_live',
        message: 'the Mechanic job already ended',
      };
    }
    switch (req.op) {
      case 'context':
        return {
          ok: true,
          result: { jobId: job.jobId, andonAt: mechanic.andonAt },
        };
      case 'incident':
      case 'escalate':
        return recordIncident(req);
      default:
        return {
          ok: false,
          code: 'precondition',
          message: `${req.op} is not a Mechanic verb: record an incident or escalate`,
        };
    }
  };

  let socket: Awaited<ReturnType<typeof startOperatorSocket>> | undefined;
  try {
    socket = await startOperatorSocket({
      path: socketPath,
      token,
      dispatch,
    });
    const env = {
      ...process.env,
      FACTORY_OPERATOR_SOCKET: socketPath,
      FACTORY_CYCLE_TOKEN: token,
    };
    await deps.pane.open({
      name,
      task: orderId,
      command: [
        adapter.kind,
        ...adapter.startArgs({
          model: operator.model,
          permission: operator.permission,
          addDirs: [repairDir],
        }),
      ],
      cwd: repairDir,
      env,
      stdoutPath: join(repairDir, 'stdout.log'),
      stderrPath: join(repairDir, 'stderr.log'),
    });
    await deps.pane.type(name, kickoff);
    const deadline = deps.now() + operator.timeoutMs;
    while (ending === undefined && !deps.signal?.aborted) {
      if (deps.now() >= deadline) break;
      const reading = await deps.pane
        .read(name)
        .catch(() => ({ operator: 'unknown' as const }));
      if (reading.operator === 'gone') break;
      await deps.sleep(deps.tickMs);
    }
  } finally {
    await deps.pane.close(name).catch(() => undefined);
    await socket?.close();
    rmSync(repairDir, { recursive: true, force: true });
  }
  return ending?.next ?? null;
};
