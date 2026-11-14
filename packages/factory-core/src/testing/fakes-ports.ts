import type { BlobRef, JobId, OrderId, WorkerId } from '../ids';
import type { Lease, LeaseStore } from '../ports/lease-store';
import type { BlobStore } from '../ports/blob-store';

/** An in-memory `BlobStore`. `put` checks nothing: the SQLite adapter owns the hash check. */
export interface FakeBlobStore extends BlobStore {
  readonly size: number;
}

export const fakeBlobStore = (): FakeBlobStore => {
  const blobs = new Map<BlobRef, Uint8Array>();
  return {
    get size() {
      return blobs.size;
    },
    put: async (ref, bytes) => {
      if (!blobs.has(ref)) blobs.set(ref, bytes);
    },
    get: async (ref) => blobs.get(ref),
    stat: async (refs) => {
      const sizes = new Map<BlobRef, number>();
      for (const ref of refs) {
        const bytes = blobs.get(ref);
        if (bytes) sizes.set(ref, bytes.byteLength);
      }
      return sizes;
    },
  };
};

/** An in-memory `LeaseStore`. Leases are keyed by order, like the `leases` table. */
export const fakeLeaseStore = (): LeaseStore => {
  const leases = new Map<OrderId, Lease>();
  const ofWorker = (workerId: WorkerId): Lease[] =>
    [...leases.values()].filter((lease) => lease.workerId === workerId);
  return {
    insert: async (lease) => {
      if (leases.has(lease.orderId)) {
        throw new Error(`order ${lease.orderId} already holds a lease`);
      }
      leases.set(lease.orderId, lease);
    },
    extend: async (workerId, jobIds: readonly JobId[], expiresAt) => {
      for (const lease of ofWorker(workerId)) {
        if (jobIds.includes(lease.jobId)) {
          leases.set(lease.orderId, { ...lease, expiresAt });
        }
      }
    },
    expired: async (now) =>
      [...leases.values()].filter((lease) => lease.expiresAt <= now),
    list: async () => [...leases.values()],
    forWorker: async (workerId) => ofWorker(workerId),
    delete: async (orderId) => {
      leases.delete(orderId);
    },
  };
};
