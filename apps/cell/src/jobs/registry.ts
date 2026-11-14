import type { Signal } from '@repo/factory-core/contracts/cell';
import type { JobId } from '@repo/factory-core/ids';

/** A job this Cell is running: its abort signal, which fires on stale, self-fence or shutdown. */
export interface JobHandle {
  readonly jobId: JobId;
  readonly signal: AbortSignal;
}

/**
 * The jobs this Cell holds right now (PROTOCOL §5.3). The heartbeat reads the ids from here, and an
 * abort from the heartbeat or the self-fence reaches the job through its signal. Signals the Factory
 * sends for a job wait here until the job takes them.
 */
export interface JobRegistry {
  start(jobId: JobId): JobHandle;
  finish(jobId: JobId): void;
  activeJobIds(): JobId[];
  abort(jobId: JobId, reason: string): void;
  abortAll(reason: string): void;
  /** Queues a signal for its job. A signal for a job not held here is dropped (and not acked). */
  deliver(signal: Signal): boolean;
  /** Takes the queued signals of a job, oldest first. */
  takeSignals(jobId: JobId): Signal[];
  /** The reason the last abort gave, for a job that was aborted. */
  abortReason(jobId: JobId): string | undefined;
}

interface Entry {
  controller: AbortController;
  signals: Signal[];
  reason?: string;
}

export const createJobRegistry = (): JobRegistry => {
  const entries = new Map<JobId, Entry>();

  const abortEntry = (entry: Entry, reason: string): void => {
    if (entry.reason === undefined) entry.reason = reason;
    entry.controller.abort(reason);
  };

  return {
    start(jobId) {
      const controller = new AbortController();
      entries.set(jobId, { controller, signals: [] });
      return { jobId, signal: controller.signal };
    },
    finish(jobId) {
      entries.delete(jobId);
    },
    activeJobIds() {
      return [...entries.keys()];
    },
    abort(jobId, reason) {
      const entry = entries.get(jobId);
      if (entry) abortEntry(entry, reason);
    },
    abortAll(reason) {
      for (const entry of entries.values()) abortEntry(entry, reason);
    },
    deliver(signal) {
      const entry = entries.get(signal.jobId);
      if (!entry) return false;
      entry.signals.push(signal);
      return true;
    },
    takeSignals(jobId) {
      const entry = entries.get(jobId);
      if (!entry) return [];
      return entry.signals.splice(0);
    },
    abortReason(jobId) {
      return entries.get(jobId)?.reason;
    },
  };
};
