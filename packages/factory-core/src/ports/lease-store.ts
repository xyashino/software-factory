import type { WorkerId, JobId, OrderId } from '../ids';

/** The lease held by the Worker running the active job of a Work order (STORAGE §4, `leases`). */
export interface Lease {
  orderId: OrderId;
  jobId: JobId;
  workerId: WorkerId;
  epoch: number;
  expiresAt: number;
}

export interface LeaseStore {
  insert(lease: Lease): Promise<void>;
  /** Pushes the expiry of every listed job held by the Worker. */
  extend(
    workerId: WorkerId,
    jobIds: readonly JobId[],
    expiresAt: number,
  ): Promise<void>;
  /** Leases whose expiry is at or before `now`. */
  expired(now: number): Promise<Lease[]>;
  /** Every lease, in no particular order (boot grace). */
  list(): Promise<Lease[]>;
  /** The leases one Worker holds (heartbeat, revocation, slot count). */
  forWorker(workerId: WorkerId): Promise<Lease[]>;
  delete(orderId: OrderId): Promise<void>;
}
