import type { CellId, JobId, OrderId } from '../ids';

/** The lease held by the Cell running the active job of a Work order (STORAGE §4, `leases`). */
export interface Lease {
  orderId: OrderId;
  jobId: JobId;
  cellId: CellId;
  epoch: number;
  expiresAt: number;
}

export interface LeaseStore {
  insert(lease: Lease): Promise<void>;
  /** Pushes the expiry of every listed job held by the Cell. */
  extend(
    cellId: CellId,
    jobIds: readonly JobId[],
    expiresAt: number,
  ): Promise<void>;
  /** Leases whose expiry is at or before `now`. */
  expired(now: number): Promise<Lease[]>;
  delete(orderId: OrderId): Promise<void>;
}
