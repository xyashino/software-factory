import { type BlobKind, SWEEP_AGE_MS, fitBlob } from '../blob-rules';
import type {
  BlobRef,
  CellId,
  CommitSha,
  JobId,
  OrderId,
  ProjectId,
  TodoId,
} from '../ids';
import type { BlobStore } from '../ports/blob-store';
import type { Clock } from '../ports/clock';
import type { GitMirror, TodoFile } from '../ports/git-mirror';
import type { IntakeRecord, IntakeStore } from '../ports/intake';
import type { Lease, LeaseStore } from '../ports/lease-store';
import type { PrState, PrStatePort } from '../ports/pr-state';

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

/** An in-memory `IntakeStore`, keyed like the `intake` table: by project and todo. */
export const fakeIntakeStore = (): IntakeStore & {
  rows(): IntakeRecord[];
} => {
  const rows = new Map<string, IntakeRecord>();
  const keyOf = (projectId: ProjectId, todoId: TodoId) =>
    `${projectId}\u0000${todoId}`;
  return {
    rows: () => [...rows.values()],
    get: async (projectId, todoId) => rows.get(keyOf(projectId, todoId)),
    forProject: async (projectId) =>
      [...rows.values()].filter((row) => row.projectId === projectId),
    upsert: async (record) => {
      rows.set(keyOf(record.projectId, record.todoId), record);
    },
  };
};

/**
 * An in-memory git mirror. `setTodos` replaces the files at a new commit, so a test moves the
 * repository forward the way a push does. Commits are numbered, not hashed.
 */
export interface FakeGitMirror extends GitMirror {
  setTodos(files: TodoFile[]): CommitSha;
}

export const fakeGitMirror = (): FakeGitMirror => {
  let files: TodoFile[] = [];
  let count = 0;
  let head = commitOf(count);
  return {
    setTodos: (next) => {
      files = next.map((file) => ({ ...file }));
      count += 1;
      head = commitOf(count);
      return head;
    },
    sync: async () => head,
    todoFiles: async (_projectId, commit) =>
      commit === head ? files.map((file) => ({ ...file })) : [],
  };
};

const commitOf = (n: number): CommitSha =>
  n.toString(16).padStart(40, '0') as CommitSha;

/** An in-memory PR state reader: a test sets each pull request's state. */
export interface FakePrState extends PrStatePort {
  set(prUrl: string, state: PrState): void;
}

export const fakePrState = (): FakePrState => {
  const states = new Map<string, PrState>();
  return {
    set: (prUrl, state) => {
      states.set(prUrl, state);
    },
    read: async (prUrl) => {
      const state = states.get(prUrl);
      if (!state) throw new Error(`no fake state for ${prUrl}`);
      return state;
    },
  };
};
