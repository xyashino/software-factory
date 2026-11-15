import type { FactoryClient } from '@repo/factory-core/contracts/client';
import type { Job } from '@repo/factory-core/contracts/job';
import type { CellId } from '@repo/factory-core/ids';
import type { JobRegistry } from '../jobs/registry';
import { isUnauthorized } from '../remote-client';

export interface ClaimLoopOptions {
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
  /**
   * Runs one claimed job to its end. It resolves with the continuation the Factory handed back, the job
   * of the same Work order this Cell already holds (PROTOCOL §4), or null. The Cell is free again when it
   * returns or throws.
   */
  runJob: (job: Job, signal: AbortSignal) => Promise<Job | null>;
  onError?: (error: unknown, context: string) => void;
  /** The Factory refused the credential (401): the loop stops, and the Cell joins again. */
  onUnauthorized?: () => void;
}

/**
 * The claim loop of a Cell (PROTOCOL §5.2): one loop that claims one Work order at a time. A claimed job
 * is registered before it runs, so the heartbeat keeps its lease. Its continuations run on this Cell
 * before it claims again. A claim that fails or comes back empty waits before it tries again.
 */
export const runClaimLoop = async (
  options: ClaimLoopOptions,
): Promise<void> => {
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
      if (isUnauthorized(error)) {
        options.onUnauthorized?.();
        return;
      }
      options.onError?.(error, 'claim');
      await options.sleep(options.idlePauseMs);
      continue;
    }

    if (!job) {
      // A claim with no long-poll returns at once, so pause before asking again.
      if (options.waitMs === 0) await options.sleep(options.idlePauseMs);
      continue;
    }

    // A continuation runs on this Cell at once: the Factory already holds its lease for this Cell.
    let current: Job | null = job;
    while (current) {
      const next = await runClaimed(options, current);
      if (options.isStopped() || options.isFenced()) {
        if (next !== null) await releaseUnstarted(options, next);
        break;
      }
      current = next;
    }
  }
};

/**
 * A continuation this Cell will not run (it is stopping) is released at once, so the Work order goes back
 * to the queue for the next Cell (PROTOCOL §9: no Cycle started yet, `ReleaseJob`). A fenced Cell sends
 * nothing (PROTOCOL §5.4): its lease lapses and the reaper takes the job back.
 */
const releaseUnstarted = async (
  options: ClaimLoopOptions,
  job: Job,
): Promise<void> => {
  if (options.isFenced()) return;
  try {
    await options.client.call('submitCommand', {
      cellId: options.cellId,
      jobId: job.jobId,
      orderId: job.orderId,
      commandId: `${job.jobId}:release`,
      epoch: job.epoch,
      command: { type: 'ReleaseJob' },
    });
  } catch (error) {
    options.onError?.(error, `release job ${job.jobId}`);
  }
};

/** Runs one claimed job in the registry, so the heartbeat keeps its lease while it runs. */
const runClaimed = async (
  options: ClaimLoopOptions,
  job: Job,
): Promise<Job | null> => {
  const handle = options.registry.start(job.jobId);
  try {
    return await options.runJob(job, handle.signal);
  } catch (error) {
    options.onError?.(error, `job ${job.jobId}`);
    return null;
  } finally {
    options.registry.finish(job.jobId);
  }
};
