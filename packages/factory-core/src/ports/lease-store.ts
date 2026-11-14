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
  /** Adds a lease. Refused when the order or the job already holds one (I4). */
  insert(lease: Lease): Promise<void>;
  /** Pushes the expiry of every listed job held by the Cell. Jobs of other Cells are not touched. */
  extend(
    cellId: CellId,
    jobIds: readonly JobId[],
    expiresAt: number,
  ): Promise<void>;
  /** Leases whose expiry is at or before `now`, earliest expiry first. */
  expired(now: number): Promise<Lease[]>;
  /** Every lease, in no particular order (boot grace). */
  list(): Promise<Lease[]>;
  /** The leases one Cell holds (heartbeat, revocation, slot count). */
  forCell(cellId: CellId): Promise<Lease[]>;
  /** Removes the lease of an order. Deleting a missing lease is a no-op. */
  delete(orderId: OrderId): Promise<void>;
  /** Boot grace (PROTOCOL §5.1): every lease's expiry becomes `now + ttl`. */
  bootGrace(now: number, ttl: number): Promise<void>;
}
