import { join } from 'node:path';
import type { Job } from '@repo/factory-core/contracts/job';
import { WireFailure } from '@repo/factory-core/contracts/errors';
import type { BlobRef, CommitSha, CycleId } from '@repo/factory-core/ids';
import type {
  InspectionResult,
  OrderEvent,
} from '@repo/factory-core/order/events';
import { GIT_TIMEOUT_MS } from '../workspace/mirror';
import { prepareWorkspace } from '../workspace/prepare';
import {
  gitCommand,
  runShell,
  succeeded,
  textOf,
  type ShellContext,
} from '../workspace/shell';
import { putLog, submit, tailOf, type JobContext } from './send';

/** A station without its own timeout gets this much per command (the runtime's inspection default). */
export const DEFAULT_INSPECTION_TIMEOUT_MS = 600_000;

const MAX_DETAIL_CHARS = 500;

const errorText = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).slice(
    0,
    MAX_DETAIL_CHARS,
  );

/**
 * Runs one `run_inspection` job end to end (PROTOCOL §9, CORE §5.2). The order is fixed:
 *
 * 1. prepare the workspace. A failure uploads the log and reports `ReportWorkspaceFailed`, which needs
 *    no Cycle, so no `StartCycle` is sent before it.
 * 2. `StartCycle` from the worktree's HEAD. Every later command needs the live Cycle it opens.
 * 3. run every command of the station, each with its full log as a blob and a 2 KiB tail.
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
      cellDataDir: ctx.cellDataDir,
      worktreeLimit: ctx.worktreeLimit,
      inUse: ctx.inUse,
    },
    job,
  );
  if (!prepared.ok) {
    const logBlob = await putLog(ctx, prepared.log, signal);
    await submit(
      ctx,
      job,
      {
        type: 'ReportWorkspaceFailed',
        stage: prepared.stage,
        detail: prepared.detail.slice(0, MAX_DETAIL_CHARS),
        logBlob,
      },
      signal,
    );
    return;
  }

  try {
    if (typeof job.base === 'string' && job.base !== prepared.head) {
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
    ctx.inUse.delete(prepared.worktree);
  }
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
        tail: tailOf(textOf(run)),
        logBlob,
      });
    }

    if (signal.aborted) throw new Error('stopped before the read-only check');
    const status = await runShell(input.shell, {
      command: gitCommand(['status', '--porcelain']),
      cwd: input.worktree,
      timeoutMs: GIT_TIMEOUT_MS,
    });
    if (!succeeded(status)) {
      throw new Error('git status failed after the checks');
    }
    if (textOf(status).trim() !== '') {
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
