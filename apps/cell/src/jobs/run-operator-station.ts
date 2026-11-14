import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';
import type { CommandResult, Signal } from '@repo/factory-core/contracts/cell';
import type { FactoryClient } from '@repo/factory-core/contracts/client';
import type { Job } from '@repo/factory-core/contracts/job';
import type {
  OperatorReply,
  OperatorRequest,
} from '@repo/factory-core/contracts/operator';
import { watchPolicyFor } from '@repo/factory-core/cycle/policy';
import {
  watch,
  type Observation,
  type RuntimeCycle,
} from '@repo/factory-core/cycle/watch';
import type {
  BlobRef,
  CellId,
  CommitSha,
  CycleId,
} from '@repo/factory-core/ids';
import type { OrderCommand } from '@repo/factory-core/order/commands';
import {
  CELL_DIR,
  checkpoint,
  pushWip,
  type Outcome,
  type OutputSpec,
  type SendOutcome,
} from '../checkpoint';
import { closeHold, holdDue, openHold } from '../cycle/hold';
import { openJournal } from '../cycle/journal';
import {
  observeHeadless,
  observePane,
  startPaneClock,
  tickPaneClock,
  type PaneClock,
} from '../cycle/observe';
import type { StationRegistry, RunHandle } from '../cycle/registry';
import { typedFor, type RuntimePromptSet } from '../cycle/signals';
import { cycleDirName, paneName } from '../names';
import { newCycleToken, startOperatorSocket } from '../operator-socket';
import type {
  Clock,
  HeadlessProcess,
  PaneDriver,
  PaneReading,
  RunGit,
  SpawnHeadless,
} from '../ports';
import type { WorkspaceResult } from '../workspace';
import { getBlob, putBlob } from './blobs';

/** The usage a runner reports in its output: tokens, and the cost when the runner names one. */
export interface RunnerUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd?: number;
}

/** How one runner starts: its binary, the arguments that carry the kickoff line, and how it reports usage. */
export interface RunnerLaunch {
  binary: string;
  kickoffArgs: (kickoff: string) => string[];
  /** Reads the usage from the runner's stdout log, or nothing when it reports none (PROTOCOL §9 step 7). */
  usage?: (stdout: string) => RunnerUsage | undefined;
}

/** The durations of a station: the loop tick, the question hold and the grace for a Handover. */
export interface StationTiming {
  tickMs: number;
  questionHoldMs: number;
  handoverGraceMs: number;
}

export interface StationDeps {
  client: FactoryClient;
  cellId: CellId;
  dataDir: string;
  clock: Clock;
  sleep: (ms: number) => Promise<void>;
  git: RunGit;
  workspace: (job: Job) => Promise<WorkspaceResult>;
  runners: Readonly<Record<string, RunnerLaunch>>;
  spawn: SpawnHeadless;
  pane?: PaneDriver;
  timing: StationTiming;
  registry: StationRegistry;
  /** Optional abort signal from the Cell's shared JobRegistry (PROTOCOL §5.3–5.4). */
  signal?: AbortSignal;
  /**
   * Optional signal drain from the Cell's shared heartbeat loop. When provided, this station reads
   * signals from it instead of running a separate heartbeat call (PROTOCOL §5.3).
   */
  takeSignals?: () => Signal[];
}

type Stage = 'fetch' | 'sync' | 'worktree' | 'setup';
type FailReason = 'timed_out' | 'crashed' | 'stalled' | 'start_failed' | 'lost';
type Blobs = Record<string, BlobRef | undefined>;

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

const todoOf = (orderId: string): string =>
  orderId.slice(orderId.indexOf(':') + 1);

const isInside = (root: string, path: string): boolean => {
  const rel = relative(root, path);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
};

/** Writes an input blob at a declared path, refusing any path that leaves the worktree. */
const writeInside = (
  worktree: string,
  path: string,
  bytes: Uint8Array,
): void => {
  const root = realpathSync(worktree);
  const target = join(worktree, path);
  mkdirSync(dirname(target), { recursive: true });
  const resolved = join(realpathSync(dirname(target)), basename(target));
  if (!isInside(root, resolved))
    throw new Error(`input path ${path} leaves the worktree`);
  writeFileSync(target, bytes);
};

/** Keeps only the blobs that exist, as the command's artifacts map. */
const present = (blobs: Blobs): Record<string, BlobRef> =>
  Object.fromEntries(
    Object.entries(blobs).filter(
      (entry): entry is [string, BlobRef] => entry[1] !== undefined,
    ),
  );

/** The usage a runner printed to its stdout log, when the runner reports usage and the log is readable. */
const readUsage = (
  launch: RunnerLaunch | undefined,
  stdoutPath: string,
): RunnerUsage | undefined => {
  if (launch?.usage === undefined) return undefined;
  try {
    return launch.usage(readFileSync(stdoutPath, 'utf8'));
  } catch {
    return undefined;
  }
};

/** Runs one Operator station (PROTOCOL §9, `run_operator_station`). */
export const runOperatorStation = async (
  job: Job,
  deps: StationDeps,
): Promise<Job | null> => {
  const station = job.station;
  if (station?.operator === undefined || station.cycleId === undefined) {
    throw new Error(`job ${job.jobId} is not an Operator station`);
  }
  if (station.runtimePrompts === undefined) {
    throw new Error(`job ${job.jobId} names no runtime prompts`);
  }
  const cycleId = station.cycleId as CycleId;
  const operator = station.operator;
  const prompts: RuntimePromptSet = station.runtimePrompts;
  const policy = watchPolicyFor(operator.timeoutMs);
  const todo = todoOf(job.orderId);
  const outputs: OutputSpec[] = station.outputs ?? [];

  const submit = async (
    step: string,
    command: OrderCommand,
    dryRun = false,
  ): Promise<SendOutcome> => {
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
        orderId: job.orderId,
        commandId: `${job.jobId}:${step}`,
        epoch: job.epoch,
        command,
        ...(dryRun ? { dryRun: true } : {}),
      });
      return { ok: true, result };
    } catch (error) {
      const wire = (error as { error?: { code: string; detail?: string } })
        .error;
      if (wire === undefined) throw error;
      return { ok: false, code: wire.code, message: wire.detail ?? wire.code };
    }
  };

  if (deps.signal?.aborted) return null;

  const ws = await deps.workspace(job);
  if (!ws.ok) {
    if (deps.signal?.aborted) return null;
    const logBlob = await putBlob(deps.client, encode(ws.detail), 'text/plain');
    const stage: Stage = ws.stage;
    const reported = await submit('workspace', {
      type: 'ReportWorkspaceFailed',
      stage,
      detail: ws.detail,
      logBlob,
    });
    return reported.ok ? reported.result.next : null;
  }
  const worktree = ws.worktree;

  const started = await submit('start', {
    type: 'StartCycle',
    baseCommit: ws.base,
    operator: {
      profile: operator.profile,
      runner: operator.runner,
      model: operator.model,
    },
    ...(station.promptBlob === undefined
      ? {}
      : { promptBlob: station.promptBlob }),
  });
  if (!started.ok) return null;

  for (const input of station.inputs ?? []) {
    writeInside(worktree, input.path, await getBlob(deps.client, input.blob));
  }

  const cycleDir = join(deps.dataDir, 'cycles', cycleDirName(cycleId));
  mkdirSync(cycleDir, { recursive: true });
  const promptPath = join(cycleDir, 'prompt.md');
  if (station.promptBlob !== undefined) {
    writeFileSync(promptPath, await getBlob(deps.client, station.promptBlob));
  }
  for (const output of outputs)
    mkdirSync(dirname(join(worktree, output.path)), { recursive: true });
  const kickoff = `Read ${promptPath} and follow it exactly. Finish with the factory-operator command it names.`;
  const token = newCycleToken();
  const socketPath = join(cycleDir, 'op.sock');
  const stdoutPath = join(cycleDir, 'stdout.log');
  const stderrPath = join(cycleDir, 'stderr.log');
  const journal = openJournal(
    join(deps.dataDir, 'runtime', `${cycleId}.jsonl`),
  );

  let cycle: RuntimeCycle = {
    startedAt: deps.clock.now(),
    pausedMs: 0,
    reminders: { idle: 0, silent: 0 },
  };
  let ending: { next: Job | null } | undefined;
  let busy = false;
  let leaveDeadline: number | undefined;
  let handoverAt: number | undefined;
  let proc: HeadlessProcess | undefined;
  let pane: string | undefined;
  let paneClock: PaneClock = startPaneClock(cycle.startedAt);
  const waiters = new Map<string, (reply: OperatorReply) => void>();
  const pendingAck: string[] = [];

  const finish = (next: Job | null): void => {
    ending ??= { next };
  };

  const typeText = (text: string): void => {
    if (proc !== undefined) proc.type(text);
    else if (pane !== undefined)
      void deps.pane?.type(pane, text).catch(() => undefined);
  };

  const failCycle = async (
    reason: FailReason,
    detail: string,
  ): Promise<void> => {
    const wipCommit = await pushWip({
      worktree,
      git: deps.git,
      todoId: todo,
      orderId: job.orderId,
      stationId: station.stationId,
      n: station.n,
      cycleId,
      epoch: job.epoch,
    });
    const failed = await submit('fail', {
      type: 'FailCycle',
      cycleId,
      reason,
      detail,
      ...(wipCommit === undefined ? {} : { wipCommit }),
    });
    finish(failed.ok ? failed.result.next : null);
  };

  /** Checkpoint, then the terminal command. A refusal is reported to the Operator and the Cycle goes on. */
  const terminal = async (
    outcome: Outcome,
    upload: () => Promise<Blobs>,
    command: (commit: CommitSha, blobs: Blobs) => OrderCommand,
  ): Promise<OperatorReply> => {
    busy = true;
    try {
      if (operator.permission === 'read')
        return readOnlyFinish(upload, command);
      let blobs: Blobs = {};
      const result = await checkpoint({
        worktree,
        git: deps.git,
        todoId: todo,
        orderId: job.orderId,
        stationId: station.stationId,
        n: station.n,
        cycleId,
        epoch: job.epoch,
        outcome,
        outputs,
        upload: async () => {
          blobs = await upload();
        },
        send: (commit, dryRun) =>
          submit('checkpoint', command(commit, blobs), dryRun),
      });
      if (result.status === 'sent') {
        finish(result.result.next);
        return { ok: true };
      }
      if (result.status === 'rejected') {
        return { ok: false, code: 'precondition', message: result.detail };
      }
      if (result.status === 'fenced') {
        finish(null);
        return {
          ok: false,
          code: 'stale_epoch',
          message: 'the Cycle lost its epoch; nothing was pushed',
        };
      }
      await failCycle('crashed', result.detail);
      return { ok: false, code: 'rejected', message: result.detail };
    } finally {
      busy = false;
    }
  };

  /**
   * A read-only station commits nothing (PROTOCOL §8.3): it uploads its blobs and sends its command
   * with no commit. A tree it changed is a crash of the Cycle, never a checkpoint.
   */
  const readOnlyFinish = async (
    upload: () => Promise<Blobs>,
    command: (commit: CommitSha, blobs: Blobs) => OrderCommand,
  ): Promise<OperatorReply> => {
    const status = await deps.git(worktree, [
      'status',
      '--porcelain',
      '--',
      '.',
      `:(exclude)${CELL_DIR}`,
    ]);
    if (status.code !== 0 || status.stdout.trim() !== '') {
      await failCycle('crashed', 'read-only station changed files');
      return {
        ok: false,
        code: 'rejected',
        message: 'read-only station changed files',
      };
    }
    const blobs = await upload();
    const head = await deps.git(worktree, ['rev-parse', 'HEAD']);
    const sent = await submit(
      'checkpoint',
      command(head.stdout.trim() as CommitSha, blobs),
    );
    if (!sent.ok) return { ok: false, code: 'rejected', message: sent.message };
    finish(sent.result.next);
    return { ok: true };
  };

  const outputBlobs = async (): Promise<Blobs> => {
    const blobs: Blobs = {};
    for (const output of outputs) {
      try {
        blobs[output.key] = await putBlob(
          deps.client,
          readFileSync(join(worktree, output.path)),
        );
      } catch {
        if (output.required)
          throw new Error(`output "${output.key}" is missing`);
      }
    }
    return blobs;
  };

  const askQuestion = async (text: string): Promise<OperatorReply> => {
    const asked = await submit('ask', { type: 'AskQuestion', cycleId, text });
    if (!asked.ok)
      return { ok: false, code: 'rejected', message: asked.message };
    const event = asked.result.events.find(
      (candidate) => candidate.type === 'question_asked',
    );
    if (event === undefined || !('questionId' in event)) {
      return {
        ok: false,
        code: 'internal',
        message: 'the runtime did not open a question',
      };
    }
    const questionId = String(event.questionId);
    cycle = openHold(cycle, deps.clock.now());
    journal({ at: deps.clock.now(), kind: 'question_open', questionId });
    return new Promise<OperatorReply>((resolve) => {
      waiters.set(questionId, resolve);
    });
  };

  const dispatch = async (req: OperatorRequest): Promise<OperatorReply> => {
    if (ending !== undefined || deps.signal?.aborted) {
      return {
        ok: false,
        code: 'not_live',
        message: 'the Cycle already ended',
      };
    }
    switch (req.op) {
      case 'done':
        return terminal('passed', outputBlobs, (commit, blobs) => ({
          type: 'CompleteCycle',
          cycleId,
          artifacts: present(blobs),
          commit,
        }));
      case 'verdict': {
        if (!req.pass && req.feedback === undefined) {
          return {
            ok: false,
            code: 'invalid',
            message: 'a failing verdict needs --feedback',
          };
        }
        const feedback = req.feedback;
        return terminal(
          req.pass ? 'passed' : 'failed',
          async () => ({
            ...(await outputBlobs()),
            feedback:
              feedback === undefined
                ? undefined
                : await putBlob(deps.client, encode(feedback)),
          }),
          (commit, blobs) => ({
            type: 'SubmitVerdict',
            cycleId,
            pass: req.pass,
            artifacts: present(
              Object.fromEntries(
                Object.entries(blobs).filter(([key]) => key !== 'feedback'),
              ),
            ),
            ...(blobs.feedback === undefined
              ? {}
              : { feedbackBlob: blobs.feedback }),
            commit,
          }),
        );
      }
      case 'block': {
        const handing = leaveDeadline !== undefined;
        const handover = await putBlob(deps.client, encode(req.handover));
        return terminal(
          handing ? 'handed_over' : 'blocked',
          async () => ({ handover }),
          (commit, blobs): OrderCommand =>
            handing
              ? {
                  type: 'HandOverCycle',
                  cycleId,
                  handoverBlob: blobs.handover as BlobRef,
                  commit,
                }
              : {
                  type: 'BlockCycle',
                  cycleId,
                  source: 'operator',
                  reason: 'operator_reported',
                  detail: req.reason,
                  handoverBlob: blobs.handover,
                  commit,
                },
        );
      }
      case 'ask':
        return askQuestion(req.text);
      case 'tell': {
        const told = await submit('tell', {
          type: 'LeaveNote',
          cycleId,
          to: req.to,
          text: req.text,
        });
        return told.ok
          ? { ok: true }
          : { ok: false, code: 'rejected', message: told.message };
      }
      case 'context':
        return {
          ok: true,
          result: {
            cycleId,
            stationId: station.stationId,
            inputs: (station.inputs ?? []).map((input) => input.path),
            outputs: outputs.map((output) => output.path),
          },
        };
    }
  };

  const onSignal = (signal: Signal): void => {
    const now = deps.clock.now();
    typeText(typedFor(signal, prompts));
    if (signal.kind === 'answer') {
      journal({ at: now, kind: 'answer_typed', questionId: signal.questionId });
      const resolve = waiters.get(signal.questionId);
      if (resolve !== undefined) {
        waiters.delete(signal.questionId);
        cycle = closeHold(cycle, now);
        resolve({
          ok: true,
          result: { answer: signal.text, questionId: signal.questionId },
        });
      }
    } else {
      journal({ at: now, kind: 'nudge_typed' });
    }
  };

  /**
   * What the Operator looks like now: a headless process by its liveness and log, a pane by the
   * status Herdr reports and the time its tail last changed. A pane read that fails is `unknown`,
   * which the watch does not act on.
   */
  const observe = async (): Promise<Observation> => {
    if (proc !== undefined) {
      return observeHeadless(proc, stdoutPath, cycle.startedAt);
    }
    if (pane === undefined || deps.pane === undefined) {
      return { operator: 'working', lastOutputAt: cycle.startedAt };
    }
    const reading = await deps.pane
      .read(pane)
      .catch((): PaneReading => ({ operator: 'unknown' }));
    const tail = await deps.pane.tail(pane).catch(() => paneClock.tail);
    paneClock = tickPaneClock(paneClock, tail, deps.clock.now());
    return observePane(reading, paneClock);
  };

  /**
   * A runtime block (PROTOCOL §8.2): the Cycle ends as `blocked`, so the checkpoint runs first and the
   * commit carries `Factory-Outcome: blocked`. A refused checkpoint leaves the Cycle open; the next tick
   * tries again.
   */
  const runtimeBlock = async (
    reason: 'runner_prompt' | 'question_timeout',
    detail: string,
  ): Promise<void> => {
    await terminal(
      'blocked',
      async () => ({}),
      (commit): OrderCommand => ({
        type: 'BlockCycle',
        cycleId,
        source: 'runtime',
        reason,
        detail,
        commit,
      }),
    );
  };

  /** One pass of the loop: heartbeat or shared signals, the hold and leave deadlines, then the watch. */
  const tick = async (): Promise<void> => {
    if (deps.takeSignals !== undefined) {
      if (deps.signal?.aborted) return finish(null);
      for (const signal of deps.takeSignals()) onSignal(signal);
    } else {
      const heartbeat = await deps.client
        .call('heartbeat', {
          cellId: deps.cellId,
          jobs: [job.jobId],
          acked: pendingAck.splice(0),
        })
        .catch(() => undefined);
      if (heartbeat !== undefined) {
        if (heartbeat.jobs.some((entry) => entry.status === 'stale'))
          return finish(null);
        for (const signal of heartbeat.signals) {
          onSignal(signal);
          pendingAck.push(signal.signalId);
        }
      }
    }
    if (ending !== undefined || busy || deps.signal?.aborted) return;

    const now = deps.clock.now();
    if (leaveDeadline !== undefined && now >= leaveDeadline) {
      const released = await submit('release', { type: 'ReleaseJob' });
      return finish(released.ok ? released.result.next : null);
    }
    if (
      holdDue(cycle, now, deps.timing.questionHoldMs) &&
      handoverAt === undefined
    ) {
      typeText(prompts.handoverRequest);
      handoverAt = now;
      journal({ at: now, kind: 'hold_expired_handover_requested' });
    }
    if (
      handoverAt !== undefined &&
      now - handoverAt >= deps.timing.handoverGraceMs
    ) {
      return runtimeBlock(
        'question_timeout',
        'the Operator did not hand over after the question hold',
      );
    }

    const decision = watch(cycle, await observe(), now, policy);
    switch (decision.type) {
      case 'none':
        return;
      case 'remind': {
        cycle = {
          ...cycle,
          reminders: {
            ...cycle.reminders,
            [decision.kind]: cycle.reminders[decision.kind] + 1,
          },
        };
        typeText(
          decision.kind === 'idle'
            ? prompts.idleReminder
            : prompts.silentReminder,
        );
        journal({ at: now, kind: `remind_${decision.kind}` });
        return;
      }
      case 'fail':
        journal({ at: now, kind: 'fail', reason: decision.reason });
        return failCycle(
          decision.reason,
          `watch ended the Cycle: ${decision.reason}`,
        );
      case 'block':
        return runtimeBlock('runner_prompt', 'the runner stopped on a prompt');
    }
  };

  const sleepTick = async (): Promise<void> => {
    const signal = deps.signal;
    if (signal === undefined) {
      await deps.sleep(deps.timing.tickMs);
      return;
    }
    if (signal.aborted) return;
    await new Promise<void>((resolve) => {
      const done = (): void => {
        signal.removeEventListener('abort', done);
        resolve();
      };
      signal.addEventListener('abort', done, { once: true });
      void deps.sleep(deps.timing.tickMs).then(done, done);
    });
  };

  const handle: RunHandle = {
    jobId: job.jobId,
    leave: () => {
      if (ending !== undefined || leaveDeadline !== undefined) return;
      leaveDeadline = deps.clock.now() + deps.timing.handoverGraceMs;
      journal({ at: deps.clock.now(), kind: 'handover_requested' });
      typeText(prompts.handoverRequest);
    },
  };

  let socket: Awaited<ReturnType<typeof startOperatorSocket>> | undefined;
  deps.registry.add(handle);
  try {
    socket = await startOperatorSocket({ path: socketPath, token, dispatch });
    // The Operator inherits the Cell's environment, plus the two variables its CLI reads.
    const env = {
      ...process.env,
      FACTORY_OPERATOR_SOCKET: socketPath,
      FACTORY_CYCLE_TOKEN: token,
    };
    const runner = deps.runners[operator.runner];
    if (runner === undefined) {
      await failCycle(
        'start_failed',
        `no launcher for runner ${operator.runner}`,
      );
    } else {
      const command = [runner.binary, ...runner.kickoffArgs(kickoff)];
      try {
        if (operator.headless) {
          proc = deps.spawn({
            command,
            cwd: worktree,
            env,
            stdoutPath,
            stderrPath,
          });
        } else if (deps.pane !== undefined) {
          pane = paneName(station.stationId, station.n, cycleId);
          await deps.pane.open({
            name: pane,
            command,
            cwd: worktree,
            env,
            stdoutPath,
            stderrPath,
          });
        } else {
          throw new Error('the Cell has no pane driver for a pane station');
        }
        journal({
          at: deps.clock.now(),
          kind: 'pane_ready',
          headless: operator.headless,
        });
      } catch (error) {
        await failCycle(
          'start_failed',
          error instanceof Error ? error.message : String(error),
        );
      }
    }
    while (ending === undefined && !deps.signal?.aborted) {
      // A failed tick (the runtime briefly unreachable) is retried on the next one; the leases and
      // the self-fence of the Cell decide when it gives up (PROTOCOL §5.3).
      await tick().catch(() => undefined);
      if (ending !== undefined || deps.signal?.aborted) break;
      await sleepTick();
    }
  } finally {
    deps.registry.delete(handle);
    proc?.stop();
    if (pane !== undefined) await deps.pane?.close(pane).catch(() => undefined);
    for (const resolve of waiters.values()) {
      resolve({
        ok: false,
        code: 'not_live',
        message: 'the Cycle ended before an answer',
      });
    }
    waiters.clear();
    await socket?.close();
    // The usage arrives after the Cycle may have ended: no epoch, no liveness check (PROTOCOL §9 step 7).
    if (!deps.signal?.aborted) {
      const usage = readUsage(deps.runners[operator.runner], stdoutPath);
      if (usage !== undefined) {
        await submit('usage', {
          type: 'RecordUsage',
          cycleId,
          model: operator.model,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          ...(usage.costUsd === undefined ? {} : { costUsd: usage.costUsd }),
        }).catch(() => undefined);
      }
    }
  }
  return ending?.next ?? null;
};
