import { type BlobKind, SWEEP_AGE_MS, fitBlob } from '../blob-rules';
import type { BlobRef, CellId, JobId, OrderId } from '../ids';
import type { Clock } from '../ports/clock';
import type { BlobStore } from '../ports/blob-store';
import type { Lease, LeaseStore } from '../ports/lease-store';

export interface FakeBlobStoreOptions {
  /**
   * The content address of some bytes (sha256 in the adapters). When given, `put` refuses bytes that
   * do not hash to the ref, as the SQLite store does. Core cannot hash, so tests pass it in.
   */
  refOf?: (bytes: Uint8Array) => BlobRef;
  /** The clock `created_at` is read from. */
  clock?: Clock;
}

export interface FakeBlobStore extends BlobStore {
  readonly size: number;
}

interface StoredBlob {
  bytes: Uint8Array;
  createdAt: number;
}

/** An in-memory `BlobStore` with the same size rules as the SQLite store. */
export const fakeBlobStore = (
  options: FakeBlobStoreOptions = {},
): FakeBlobStore => {
  const blobs = new Map<BlobRef, StoredBlob>();
  const clock: Clock = options.clock ?? { now: () => 0 };
  return {
    get size() {
      return blobs.size;
    },
    put: async (ref, bytes, _mediaType, kind: BlobKind = 'text') => {
      const stored = fitBlob(bytes, kind);
      if (options.refOf && options.refOf(stored) !== ref) {
        throw new Error(`blob content does not hash to ${ref}`);
      }
      if (!blobs.has(ref)) {
        blobs.set(ref, { bytes: stored, createdAt: clock.now() });
      }
    },
    get: async (ref) => blobs.get(ref)?.bytes,
    stat: async (refs) => {
      const sizes = new Map<BlobRef, number>();
      for (const ref of refs) {
        const blob = blobs.get(ref);
        if (blob) sizes.set(ref, blob.bytes.byteLength);
      }
      return sizes;
    },
    sweep: async (now, referenced) => {
      const removed: BlobRef[] = [];
      for (const [ref, blob] of blobs) {
        if (!referenced.has(ref) && blob.createdAt <= now - SWEEP_AGE_MS) {
          blobs.delete(ref);
          removed.push(ref);
        }
      }
      return removed;
    },
  };
};

/** An in-memory `LeaseStore`. Leases are keyed by order, like the `leases` table. */
export const fakeLeaseStore = (): LeaseStore => {
  const leases = new Map<OrderId, Lease>();
  const ofCell = (cellId: CellId): Lease[] =>
    [...leases.values()].filter((lease) => lease.cellId === cellId);
  const byExpiry = (a: Lease, b: Lease): number =>
    a.expiresAt - b.expiresAt || a.orderId.localeCompare(b.orderId);
  return {
    insert: async (lease) => {
      if (leases.has(lease.orderId)) {
        throw new Error(`order ${lease.orderId} already holds a lease`);
      }
      if ([...leases.values()].some((held) => held.jobId === lease.jobId)) {
        throw new Error(`job ${lease.jobId} already holds a lease`);
      }
      leases.set(lease.orderId, lease);
    },
    extend: async (cellId, jobIds: readonly JobId[], expiresAt) => {
      for (const lease of ofCell(cellId)) {
        if (jobIds.includes(lease.jobId)) {
          leases.set(lease.orderId, { ...lease, expiresAt });
        }
      }
    },
    expired: async (now) =>
      [...leases.values()]
        .filter((lease) => lease.expiresAt <= now)
        .sort(byExpiry),
    list: async () => [...leases.values()],
    forCell: async (cellId) => ofCell(cellId),
    delete: async (orderId) => {
      leases.delete(orderId);
    },
    bootGrace: async (now, ttl) => {
      for (const lease of leases.values()) {
        leases.set(lease.orderId, { ...lease, expiresAt: now + ttl });
      }
    },
  };
};
