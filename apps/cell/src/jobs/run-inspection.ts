import { join } from 'node:path';
import type { Job } from '@repo/factory-core/contracts/job';
import { WireFailure } from '@repo/factory-core/contracts/errors';
import type { BlobRef, CommitSha, CycleId } from '@repo/factory-core/ids';
import type {
  InspectionResult,
  OrderEvent,
} from '@repo/factory-core/order/events';
import { GIT_TIMEOUT_MS } from '../workspace/repo';
import { prepareWorkspace } from '../workspace/prepare';
import {
  changedSince,
  worktreeFingerprint,
  type GitRun,
} from '../workspace/snapshot';
import {
  gitCommand,
  runShell,
  succeeded,
  textOf,
  type ShellContext,
} from '../workspace/shell';
import { redactDetail } from './redact';
import { putLog, submit, type JobContext } from './send';
import { workspaceDetailOf } from './workspace-detail';

/** A station without its own timeout gets this much per command (the runtime's inspection default). */
export const DEFAULT_INSPECTION_TIMEOUT_MS = 600_000;

const MAX_DETAIL_CHARS = 500;

const errorText = (error: unknown): string =>
  redactDetail(
    error instanceof Error ? error.message : String(error),
    MAX_DETAIL_CHARS,
  );

/**
 * Runs one `run_inspection` job end to end (PROTOCOL §9, CORE §5.2). The order is fixed:
 *
 * 1. prepare the workspace. A failure uploads the log and reports `ReportWorkspaceFailed`, which needs
 *    no Cycle, so no `StartCycle` is sent before it.
 * 2. `StartCycle` from the worktree's HEAD. Every later command needs the live Cycle it opens.
 * 3. run every command of the station, each with its full log as a blob and a status tail
 *    (`passed`, `timed out`, or `failed (exit N)`). No command output reaches the event store.
 * 4. read-only check: a tree that changed during the run is `FailCycle{crashed}`, no report.
 * 5. `ReportInspection`, passed when every command exited 0 and none timed out.
 *
 * An unexpected failure after step 2 sends `FailCycle{crashed}` best-effort. A refusal (a stale epoch,
 * an unknown command) or a stopped signal sends nothing more.
 */
export const runInspection = async (
  ctx: JobContext,
  job: Job,
  signal: AbortSignal,
): Promise<void> => {
  const station = job.station;
  if (!station) throw new Error(`inspection job ${job.jobId} has no station`);
  if (signal.aborted) return;

  const shell: ShellContext = {
    system: ctx.system,
    logDir: join(ctx.cellDataDir, 'logs', job.jobId),
    signal,
  };

  const prepared = await prepareWorkspace(
    {
      shell,
      repoRoot: ctx.repoRoot,
      worktreeLimit: ctx.worktreeLimit,
      inUse: ctx.inUse,
    },
    job,
  );
  if (!prepared.ok) {
    if (prepared.missing) {
      await submit(
        ctx,
        job,
        { type: 'ReportWorktreeMissing', detail: prepared.detail },
        signal,
      );
      return;
    }
    const logBlob = await putLog(ctx, prepared.log, signal);
    await submit(
      ctx,
      job,
      {
        type: 'ReportWorkspaceFailed',
        stage: prepared.stage,
        detail: workspaceDetailOf(prepared.stage, prepared.detail),
        logBlob,
      },
      signal,
    );
    return;
  }

  try {
    // A fresh worktree sits at the job's base; a reused one keeps the work of earlier Stations on top of it.
    if (
      job.workspace?.mode !== 'reuse' &&
      typeof job.base === 'string' &&
      job.base !== prepared.head
    ) {
      const logBlob = await putLog(
        ctx,
        new TextEncoder().encode(`worktree is at ${prepared.head}`),
        signal,
      );
      await submit(
        ctx,
        job,
        {
          type: 'ReportWorkspaceFailed',
          stage: 'worktree',
          detail: `the pinned base ${job.base} is not the worktree HEAD`,
          logBlob,
        },
        signal,
      );
      return;
    }

    const started = await submit(
      ctx,
      job,
      { type: 'StartCycle', baseCommit: prepared.head as CommitSha },
      signal,
    );
    const cycleId = cycleStartedId(started.events);

    await runChecks(
      ctx,
      job,
      cycleId,
      {
        station,
        worktree: prepared.worktree,
        shell,
      },
      signal,
    );
  } finally {
    prepared.release();
  }
};

/**
 * The machine-independent status of one check, the only text of it that goes on the wire. The full
 * output stays in the check's `logBlob`.
 */
export const checkStatus = (run: {
  exitCode: number | null;
  timedOut: boolean;
}): string => {
  if (run.timedOut) return 'timed out';
  if (run.exitCode === 0) return 'passed';
  return `failed (exit ${run.exitCode ?? 'without a code'})`;
};

/** The Cycle a `StartCycle` opened, from its `cycle_started` event. */
const cycleStartedId = (events: readonly OrderEvent[]): CycleId => {
  const started = events.find(
    (event): event is Extract<OrderEvent, { type: 'cycle_started' }> =>
      event.type === 'cycle_started',
  );
  if (!started) throw new Error('StartCycle answered without cycle_started');
  return started.cycleId;
};

interface CheckInput {
  station: NonNullable<Job['station']>;
  worktree: string;
  shell: ShellContext;
}

/** The worktree's fingerprint, read through the Cell's shell so the check's own git runs are logged like any command. */
const fingerprintOf = (input: CheckInput) => {
  const git: GitRun = async (args) => {
    const run = await runShell(input.shell, {
      command: gitCommand([...args]),
      cwd: input.worktree,
      timeoutMs: GIT_TIMEOUT_MS,
    });
    return succeeded(run) ? { ok: true, text: textOf(run) } : { ok: false };
  };
  return worktreeFingerprint(input.worktree, git);
};

const runChecks = async (
  ctx: JobContext,
  job: Job,
  cycleId: CycleId,
  input: CheckInput,
  signal: AbortSignal,
): Promise<void> => {
  try {
    const timeoutMs =
      input.station.inspectionTimeoutMs ?? DEFAULT_INSPECTION_TIMEOUT_MS;
    // The read-only baseline: what earlier Stations left in the tree is not this Inspection's doing.
    const before = await fingerprintOf(input);
    const results: InspectionResult[] = [];
    for (const command of input.station.exec ?? []) {
      const run = await runShell(input.shell, {
        command,
        cwd: input.worktree,
        timeoutMs,
      });
      const logBlob: BlobRef = await putLog(ctx, run.output, signal);
      results.push({
        command,
        exitCode: run.exitCode,
        timedOut: run.timedOut,
        durationMs: run.durationMs,
        tail: checkStatus(run),
        logBlob,
      });
    }

    if (signal.aborted) throw new Error('stopped before the read-only check');
    const after = await fingerprintOf(input);
    if (changedSince(before, after)) {
      await submit(
        ctx,
        job,
        {
          type: 'FailCycle',
          cycleId,
          reason: 'crashed',
          detail: 'read-only station changed files',
        },
        signal,
      );
      return;
    }

    const passed = results.every(
      (result) => result.exitCode === 0 && !result.timedOut,
    );
    await submit(
      ctx,
      job,
      { type: 'ReportInspection', cycleId, passed, results },
      signal,
    );
  } catch (error) {
    if (error instanceof WireFailure || signal.aborted) throw error;
    await submit(
      ctx,
      job,
      {
        type: 'FailCycle',
        cycleId,
        reason: 'crashed',
        detail: errorText(error),
      },
      signal,
    ).catch(() => undefined);
    throw error;
  }
};
