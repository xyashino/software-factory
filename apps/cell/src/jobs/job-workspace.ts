import { join } from 'node:path';
import type { Job } from '@repo/factory-core/contracts/job';
import { prepareWorkspace, type PrepareResult } from '../workspace/prepare';
import type { ShellContext } from '../workspace/shell';
import type { JobContext } from './send';

/** The shell a job's workspace commands run in: the Cell's system, the job's log directory, the job's signal. */
export const shellFor = (
  ctx: JobContext,
  job: Job,
  signal: AbortSignal,
): ShellContext => ({
  system: ctx.system,
  logDir: join(ctx.cellDataDir, 'logs', job.jobId),
  signal,
});

/**
 * Prepares a Work order job's workspace through the one shared path. Station, inspection and delivery of
 * one order on one Cell land in the same worktree, and the worktree stays in `ctx.inUse` until the caller
 * releases it.
 */
export const prepareJobWorkspace = (
  ctx: JobContext,
  job: Job,
  signal: AbortSignal,
): Promise<PrepareResult> =>
  prepareWorkspace(
    {
      shell: shellFor(ctx, job, signal),
      cellDataDir: ctx.cellDataDir,
      worktreeLimit: ctx.worktreeLimit,
      inUse: ctx.inUse,
    },
    job,
  );
