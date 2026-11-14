import type { FactoryClient } from '@repo/factory-core/contracts/client';
import type { Job } from '@repo/factory-core/contracts/job';
import type { CellId } from '@repo/factory-core/ids';
import type { JobRegistry } from '../jobs/registry';

export interface SlotOptions {
  client: FactoryClient;
  cellId: CellId;
  registry: JobRegistry;
  /** Claims wait while this is true (self-fence). */
  isFenced: () => boolean;
  /** Stops the loop after the current step. */
  isStopped: () => boolean;
  /** Long-poll length of one claim, at most `MAX_CLAIM_WAIT_MS`. */
  waitMs: number;
  /** Pause after an empty or failed claim, and while fenced. */
  idlePauseMs: number;
  sleep: (ms: number) => Promise<void>;
  /** Runs one claimed job to its end. The slot is free again when it returns or throws. */
  runJob: (job: Job, signal: AbortSignal) => Promise<void>;
  onError?: (error: unknown, context: string) => void;
}

/**
 * One slot of a Cell (PROTOCOL §5.2): a loop that claims one job at a time. A claimed job is registered
 * before it runs, so the heartbeat keeps its lease, and the slot is free again once it ends. A claim
 * that fails or comes back empty waits before it tries again.
 */
export const runSlot = async (options: SlotOptions): Promise<void> => {
  while (!options.isStopped()) {
    if (options.isFenced()) {
      await options.sleep(options.idlePauseMs);
      continue;
    }

    let job: Job | null;
    try {
      const answer = await options.client.call('claim', {
        cellId: options.cellId,
        waitMs: options.waitMs,
      });
      job = answer.job;
    } catch (error) {
      options.onError?.(error, 'claim');
      await options.sleep(options.idlePauseMs);
      continue;
    }

    if (!job) {
      // A claim with no long-poll returns at once, so pause before asking again.
      if (options.waitMs === 0) await options.sleep(options.idlePauseMs);
      continue;
    }

    const handle = options.registry.start(job.jobId);
    try {
      await options.runJob(job, handle.signal);
    } catch (error) {
      options.onError?.(error, `job ${job.jobId}`);
    } finally {
      options.registry.finish(job.jobId);
    }
  }
};
