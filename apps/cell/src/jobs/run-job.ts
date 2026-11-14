import { rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Job } from '@repo/factory-core/contracts/job';
import type { JobContext } from './send';
import { runInspection } from './run-inspection';

/** A job kind this Cell does not run yet (operator stations and delivery come in later tasks). */
export class UnsupportedJobKind extends Error {
  constructor(kind: string) {
    super(`this Cell does not run ${kind} jobs yet`);
    this.name = 'UnsupportedJobKind';
  }
}

/**
 * Dispatches a claimed job by its kind. Only `run_inspection` runs here; any other kind throws
 * `UnsupportedJobKind` before a command is sent, so its lease lapses and the reaper takes it back. The
 * job's log directory is removed when the job ends, whatever the outcome.
 */
export const runJob = async (
  ctx: JobContext,
  job: Job,
  signal: AbortSignal,
): Promise<void> => {
  try {
    switch (job.kind) {
      case 'run_inspection':
        await runInspection(ctx, job, signal);
        return;
      default:
        throw new UnsupportedJobKind(job.kind);
    }
  } finally {
    rmSync(join(ctx.cellDataDir, 'logs', job.jobId), {
      recursive: true,
      force: true,
    });
  }
};
