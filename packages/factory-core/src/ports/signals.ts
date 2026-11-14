import type { JobId } from '../ids';
import type { Signal } from '../contracts/worker';

/** A signal as the runtime writes it: the wire Signal plus the time it was created. */
export type NewSignal = Signal & { createdAt: number };

/** Signals to a running job (PROTOCOL §7). Kept until acknowledged or until the job ends. */
export interface SignalStore {
  insert(signal: NewSignal): Promise<void>;
  /** Unacknowledged signals of one job, oldest first. */
  unacked(jobId: JobId): Promise<Signal[]>;
  /** Marks the listed signals acknowledged. Unknown ids are ignored. */
  ack(signalIds: readonly string[], at: number): Promise<void>;
  /** Removes every signal of a job that has ended. */
  deleteForJob(jobId: JobId): Promise<void>;
}
