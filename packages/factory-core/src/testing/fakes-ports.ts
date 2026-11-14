import { type BlobKind, SWEEP_AGE_MS, fitBlob } from '../blob-rules';
import type {
  BlobRef,
  CellId,
  CommitSha,
  JobId,
  ProjectId,
  TodoId,
} from '../ids';
import type { BlobStore } from '../ports/blob-store';
import type { Clock } from '../ports/clock';
import type { BranchLog, GitMirror, TodoFile } from '../ports/git-mirror';
import type { IntakeRecord, IntakeStore } from '../ports/intake';
import type { Lease, LeaseStore, LeaseStreamId } from '../ports/lease-store';
import type { PrForBranch, PrState, PrStatePort } from '../ports/pr-state';
import type {
  ProjectPatch,
  ProjectRecord,
  ProjectStore,
  ProjectStoreResult,
} from '../ports/projects';
import type { BoardStatus } from '../order/status';

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
  const leases = new Map<LeaseStreamId, Lease>();
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
  /** Replaces the branches the mirror lists; a test gives each branch its commits, newest first. */
  setBranches(branches: BranchLog[]): void;
}

export const fakeGitMirror = (): FakeGitMirror => {
  let files: TodoFile[] = [];
  let branches: BranchLog[] = [];
  let count = 0;
  let head = commitOf(count);
  return {
    setTodos: (next) => {
      files = next.map((file) => ({ ...file }));
      count += 1;
      head = commitOf(count);
      return head;
    },
    setBranches: (next) => {
      branches = next.map((log) => ({
        branch: log.branch,
        commits: log.commits.map((commit) => ({ ...commit })),
      }));
    },
    sync: async () => head,
    todoFiles: async (_projectId, commit) =>
      commit === head ? files.map((file) => ({ ...file })) : [],
    branches: async (_projectId, prefix) =>
      branches
        .filter((log) => log.branch.startsWith(prefix))
        .map((log) => ({
          branch: log.branch,
          commits: log.commits.map((commit) => ({ ...commit })),
        })),
  };
};

const commitOf = (n: number): CommitSha =>
  n.toString(16).padStart(40, '0') as CommitSha;

/** An in-memory PR state reader: a test sets each pull request's state. */
export interface FakePrState extends PrStatePort {
  set(prUrl: string, state: PrState): void;
  /** Gives the branch a pull request, as `gh pr list --head` would find it. */
  setForBranch(branch: string, pr: PrForBranch): void;
}

export const fakePrState = (): FakePrState => {
  const states = new Map<string, PrState>();
  const byBranch = new Map<string, PrForBranch>();
  return {
    set: (prUrl, state) => {
      states.set(prUrl, state);
    },
    read: async (prUrl) => {
      const state = states.get(prUrl);
      if (!state) throw new Error(`no fake state for ${prUrl}`);
      return state;
    },
    setForBranch: (branch, pr) => {
      byBranch.set(branch, { ...pr });
    },
    forBranch: async (_repoUrl, branch) => {
      const pr = byBranch.get(branch);
      return pr === undefined ? undefined : { ...pr };
    },
  };
};

/** The board statuses after which a Work order no longer holds its project's base branch (CORE §4.2). */
const TERMINAL_STATUSES: ReadonlySet<BoardStatus> = new Set([
  'delivered',
  'merged',
  'cancelled',
]);

/**
 * What a project already has in history, as the test sets it: the guards of `remove` and `set` read
 * these, so a contract case can say "this project has an order" without a runtime (PROTOCOL §3.1).
 */
export interface ProjectHistorySeed {
  /** A Work order of the project, in this board status. */
  seedOrder(projectId: ProjectId, status: BoardStatus): Promise<void>;
  /** An event whose order belongs to the project. */
  seedEvent(projectId: ProjectId): Promise<void>;
  /** An intake row of the project. */
  seedIntake(projectId: ProjectId): Promise<void>;
}

/** Where a fake project store reads a project's Work orders from, besides the ones seeded by hand. */
export interface ProjectOrderSource {
  /** The board status of every Work order of the project. */
  statusesOf(projectId: ProjectId): Promise<readonly BoardStatus[]>;
}

const byProjectId = (a: ProjectRecord, b: ProjectRecord): number =>
  a.projectId < b.projectId ? -1 : a.projectId > b.projectId ? 1 : 0;

/** An in-memory `ProjectStore` with the guards of the SQLite store (PROTOCOL §3.1). */
export const fakeProjectStore = (
  initial: readonly ProjectRecord[] = [],
  source?: ProjectOrderSource,
): ProjectStore & ProjectHistorySeed => {
  const records = new Map<ProjectId, ProjectRecord>(
    initial.map((record) => [record.projectId, { ...record }]),
  );
  const orders = new Map<ProjectId, BoardStatus[]>();
  const events = new Map<ProjectId, number>();
  const intake = new Map<ProjectId, number>();
  const ordersOf = async (
    projectId: ProjectId,
  ): Promise<readonly BoardStatus[]> => [
    ...(orders.get(projectId) ?? []),
    ...((await source?.statusesOf(projectId)) ?? []),
  ];
  const hasHistory = async (projectId: ProjectId): Promise<boolean> =>
    (await ordersOf(projectId)).length > 0 ||
    (events.get(projectId) ?? 0) > 0 ||
    (intake.get(projectId) ?? 0) > 0;
  const holdsBase = async (projectId: ProjectId): Promise<boolean> =>
    (await ordersOf(projectId)).some(
      (status) => !TERMINAL_STATUSES.has(status),
    );
  const count = (map: Map<ProjectId, number>, projectId: ProjectId): void => {
    map.set(projectId, (map.get(projectId) ?? 0) + 1);
  };
  return {
    list: async () =>
      [...records.values()].sort(byProjectId).map((record) => ({ ...record })),
    add: async (project): Promise<ProjectStoreResult> => {
      if (records.has(project.projectId))
        return { ok: false, reason: 'exists' };
      records.set(project.projectId, { ...project });
      return { ok: true };
    },
    set: async (
      projectId,
      patch: ProjectPatch,
    ): Promise<ProjectStoreResult> => {
      const record = records.get(projectId);
      if (!record) return { ok: false, reason: 'missing' };
      const changesBase =
        patch.baseBranch !== undefined &&
        patch.baseBranch !== record.baseBranch;
      if (changesBase && (await holdsBase(projectId))) {
        return { ok: false, reason: 'base_branch_busy' };
      }
      records.set(projectId, {
        ...record,
        baseBranch: patch.baseBranch ?? record.baseBranch,
        maxRunning: patch.maxRunning ?? record.maxRunning,
        depPolicy: patch.depPolicy ?? record.depPolicy,
      });
      return { ok: true };
    },
    remove: async (projectId): Promise<ProjectStoreResult> => {
      if (!records.has(projectId)) return { ok: false, reason: 'missing' };
      if (await hasHistory(projectId))
        return { ok: false, reason: 'has_history' };
      records.delete(projectId);
      return { ok: true };
    },
    seedOrder: async (projectId, status) => {
      orders.set(projectId, [...(orders.get(projectId) ?? []), status]);
    },
    seedEvent: async (projectId) => count(events, projectId),
    seedIntake: async (projectId) => count(intake, projectId),
  };
};
