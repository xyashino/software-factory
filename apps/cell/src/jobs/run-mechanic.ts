import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CommandResult } from '@repo/factory-core/contracts/cell';
import type { FactoryClient } from '@repo/factory-core/contracts/client';
import type { Job } from '@repo/factory-core/contracts/job';
import type {
  OperatorReply,
  OperatorRequest,
} from '@repo/factory-core/contracts/operator';
import type { CellId, CommitSha } from '@repo/factory-core/ids';
import type { OrderCommand } from '@repo/factory-core/order/commands';
import { getRunner } from '../adapters/runners/registry';
import { CELL_DIR } from '../checkpoint';
import { paneName } from '../names';
import { newCycleToken, startOperatorSocket } from '../operator-socket';
import type { PaneDriver } from '../ports';
import type { SystemPort } from '../ports/system.port';
import { GIT_TIMEOUT_MS } from '../workspace/mirror';
import { prepareWorkspace } from '../workspace/prepare';
import {
  describeFailure,
  gitCommand,
  runShell,
  succeeded,
  textOf,
  type ShellContext,
} from '../workspace/shell';
import { getBlob } from './blobs';
import { orderIdOf, todoOf } from './job-shape';
import { logCommandOf } from './pane-commands';

/** What the Mechanic is told to do when its incident says `nudge` (CORE §14.3). */
export const MECHANIC_NUDGE =
  'Continue the task and finish with the factory-operator command it names.';

const COMMIT_RE = /^[0-9a-f]{40}$/;
const GIT_IDENTITY = [
  '-c',
  'user.name=factory-cell',
  '-c',
  'user.email=cell@factory.invalid',
] as const;

export interface MechanicDeps {
  client: FactoryClient;
  cellId: CellId;
  dataDir: string;
  /** Optional system port + worktree tracking; when present with `job.workspace`, runs in the Work order worktree. */
  system?: SystemPort;
  worktreeLimit?: number;
  inUse?: Set<string>;
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
 * The repair scratch dir of one Mechanic job: holds the prompt, operator socket, logs and `bin` shim,
 * named by a hash so the socket path stays short.
 */
const repairDirOf = (dataDir: string, jobId: string): string =>
  join(
    dataDir,
    'repairs',
    createHash('sha256').update(jobId).digest('hex').slice(0, 16),
  );

/** A `factory-operator` shim for the Mechanic's PATH, run by the same runtime as the Cell. */
const operatorBinOf = (dir: string): string => {
  const binDir = join(dir, 'bin');
  mkdirSync(binDir, { recursive: true });
  const cli = fileURLToPath(
    new URL('../../../operator-cli/src/cli.ts', import.meta.url),
  );
  const shim = join(binDir, 'factory-operator');
  writeFileSync(shim, `#!/bin/sh\nexec "${process.execPath}" "${cli}" "$@"\n`);
  chmodSync(shim, 0o755);
  return binDir;
};

type RepairSync =
  | { ok: true; commit?: CommitSha; changedFiles: string[] }
  | { ok: false; detail: string };

/**
 * Commits any uncommitted edits the Mechanic left in the worktree (`--no-verify`, since the next
 * station or delivery runs the authoritative checks), pushes to the Work order branch if `HEAD`
 * moved past `startHead`, and returns the resulting commit + changed paths.
 */
const commitAndPushRepair = async (input: {
  shell: ShellContext;
  worktree: string;
  startHead: string;
  repoUrl: string;
  branch: string;
  orderId: string;
  attempt: number;
  diagnosis: string;
}): Promise<RepairSync> => {
  const git = (args: readonly string[]) =>
    runShell(input.shell, {
      command: gitCommand(args),
      cwd: input.worktree,
      timeoutMs: GIT_TIMEOUT_MS,
    });

  const status = await git([
    'status',
    '--porcelain',
    '--',
    '.',
    `:(exclude)${CELL_DIR}`,
  ]);
  if (!succeeded(status)) {
    return {
      ok: false,
      detail: `git status failed: ${describeFailure(status, GIT_TIMEOUT_MS)}`,
    };
  }
  if (textOf(status).trim() !== '') {
    // `.cell/` is excluded via the mirror's `info/exclude` written by `ensureMirror`.
    const added = await git(['add', '-A', '--', '.']);
    if (!succeeded(added)) {
      return {
        ok: false,
        detail: `git add failed: ${describeFailure(added, GIT_TIMEOUT_MS)}`,
      };
    }
    const subject = `fix(mechanic): ${input.diagnosis.replace(/\s+/g, ' ').trim().slice(0, 72)}`;
    const body = `Factory-Order: ${input.orderId}\nFactory-Mechanic-Attempt: ${input.attempt}`;
    const committed = await git([
      ...GIT_IDENTITY,
      'commit',
      '--quiet',
      '--no-verify',
      '-m',
      subject,
      '-m',
      body,
    ]);
    if (!succeeded(committed)) {
      return {
        ok: false,
        detail: `git commit failed: ${describeFailure(committed, GIT_TIMEOUT_MS)}`,
      };
    }
  }

  const headRun = await git(['rev-parse', 'HEAD']);
  const currentHead = textOf(headRun).trim();
  if (!succeeded(headRun) || !COMMIT_RE.test(currentHead)) {
    return { ok: false, detail: 'worktree has no valid HEAD commit' };
  }
  if (currentHead === input.startHead) {
    return { ok: true, changedFiles: [] };
  }

  const branchRef = `refs/heads/${input.branch}`;
  const tipRun = await git([
    'rev-parse',
    '--verify',
    '--quiet',
    `${branchRef}^{commit}`,
  ]);
  const remoteTip = succeeded(tipRun) ? textOf(tipRun).trim() : '';
  const lease = `${branchRef}:${remoteTip}`;
  // Push directly to repoUrl (not `origin`): the mirror is a `--mirror` clone that rejects explicit refspecs.
  const pushed = await git([
    'push',
    '--quiet',
    `--force-with-lease=${lease}`,
    input.repoUrl,
    `${currentHead}:${branchRef}`,
  ]);
  if (!succeeded(pushed)) {
    return {
      ok: false,
      detail: `git push of ${input.branch} failed: ${textOf(pushed).trim() || describeFailure(pushed, GIT_TIMEOUT_MS)}`,
    };
  }

  const diff = await git([
    'diff',
    '--name-only',
    input.startHead,
    currentHead,
    '--',
    '.',
    `:(exclude)${CELL_DIR}`,
  ]);
  const changedFiles = succeeded(diff)
    ? textOf(diff)
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
    : [];
  return { ok: true, commit: currentHead as CommitSha, changedFiles };
};

/**
 * Runs one Mechanic job (CORE §14.4): prepares the Work order's worktree when available (falling back
 * to the repair scratch dir if preparation fails), runs the incident prompt in a Herdr pane, and
 * commits & pushes any worktree edits on `repair` / `resume` before recording the incident.
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
  let promptBytes = await getBlob(deps.client, mechanic.promptBlob);

  const inUse = deps.inUse ?? new Set<string>();
  const shell: ShellContext | undefined =
    deps.system !== undefined
      ? {
          system: deps.system,
          logDir: join(deps.dataDir, 'logs', job.jobId),
          signal: deps.signal,
        }
      : undefined;

  let worktree: string | undefined;
  let startHead: string | undefined;
  if (job.workspace !== undefined && shell !== undefined) {
    const prepared = await prepareWorkspace(
      {
        shell,
        cellDataDir: deps.dataDir,
        worktreeLimit: deps.worktreeLimit ?? 8,
        inUse,
      },
      job,
    );
    if (prepared.ok) {
      worktree = prepared.worktree;
      startHead = prepared.head;
    } else {
      const note = Buffer.from(
        `\n### Workspace prepare note\n\nPreparing the Work order worktree failed at \`${prepared.stage}\`: ${prepared.detail}\nYou are running in the repair directory instead.\n`,
        'utf8',
      );
      promptBytes = Buffer.concat([promptBytes, note]);
    }
  }
  writeFileSync(promptPath, promptBytes);

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

  /** Records the incident (syncing worktree edits first if applicable), then runs its follow-up. */
  const recordIncident = async (
    req: Extract<OperatorRequest, { op: 'incident' | 'escalate' }>,
  ): Promise<OperatorReply> => {
    let commit: CommitSha | undefined;
    let actionKind = req.op === 'escalate' ? 'escalate' : req.action;
    let changes = req.op === 'escalate' ? [] : req.changes;

    if (
      req.op === 'incident' &&
      (req.action === 'repair' || req.action === 'resume') &&
      worktree !== undefined &&
      startHead !== undefined &&
      shell !== undefined
    ) {
      const synced = await commitAndPushRepair({
        shell,
        worktree,
        startHead,
        repoUrl: job.repo.url,
        branch: job.repo.branch,
        orderId: job.orderId,
        attempt: mechanic.n,
        diagnosis: req.diagnosis,
      });
      if (!synced.ok) {
        return { ok: false, code: 'rejected', message: synced.detail };
      }
      commit = synced.commit;
      const repairCommit = synced.commit;
      if (synced.changedFiles.length > 0 && repairCommit !== undefined) {
        actionKind = 'repair';
        if (changes.length === 0) {
          changes = synced.changedFiles.slice(0, 16).map((path) => ({
            kind: 'file' as const,
            path,
            ref: repairCommit,
          }));
        }
      }
    }

    const incident: OrderCommand =
      req.op === 'incident'
        ? {
            type: 'RecordIncident',
            diagnosis: req.diagnosis,
            action: { kind: actionKind as typeof req.action },
            changes,
            outcome: req.outcome,
            ...(commit !== undefined ? { commit } : {}),
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
      PATH: `${operatorBinOf(repairDir)}:${process.env.PATH ?? ''}`,
      FACTORY_OPERATOR_SOCKET: socketPath,
      FACTORY_CYCLE_TOKEN: token,
    };
    const cwd = worktree ?? repairDir;
    const addDirs = worktree ? [repairDir, worktree] : [repairDir];
    await deps.pane.open({
      name,
      task: todoOf(orderId),
      logCommand: logCommandOf(job.orderId),
      command: [
        adapter.kind,
        ...adapter.startArgs({
          model: operator.model,
          permission: operator.permission,
          addDirs,
        }),
      ],
      cwd,
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
      if (reading.operator === 'blocked') {
        // A folder-trust or runner prompt stops the Mechanic: confirm it as the station does. If it
        // cannot be confirmed, hand the Andon to the Supervisor instead of leaving the Work order stuck.
        const trusted = await deps.pane.confirmTrust(name).catch(() => false);
        if (!trusted) {
          await recordIncident({
            op: 'escalate',
            token,
            diagnosis:
              'the Mechanic pane stopped on a prompt it could not confirm',
            outcome: 'escalated to the Supervisor',
          });
          break;
        }
      }
      await deps.sleep(deps.tickMs);
    }
  } finally {
    if (worktree !== undefined) inUse.delete(worktree);
    await deps.pane.close(name).catch(() => undefined);
    await socket?.close();
    rmSync(repairDir, { recursive: true, force: true });
  }
  return ending?.next ?? null;
};
