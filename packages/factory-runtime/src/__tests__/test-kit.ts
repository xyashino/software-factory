import { createHash } from 'node:crypto';
import {
  fakeClock,
  fakeBlobStore,
  fakeEventStore,
  fakeGitMirror,
  fakeIntakeStore,
  fakeLeaseStore,
  fakePrState,
} from '@repo/factory-core/testing';
import type { ArchivePort } from '@repo/factory-core/ports/archive';
import type { FakeClock } from '@repo/factory-core/testing';
import {
  orderIdOf,
  type BlobRef,
  type OrderId,
  type ProjectId,
  type TodoId,
  type CellId,
} from '@repo/factory-core/ids';
import type { OrderCommand } from '@repo/factory-core/order/commands';
import type { Actor } from '@repo/factory-core/order/events';
import type { Clock } from '@repo/factory-core/ports/clock';
import type {
  ProjectRecord,
  ProjectStore,
} from '@repo/factory-core/ports/projects';
import type { SignalStore, NewSignal } from '@repo/factory-core/ports/signals';
import type { Signal } from '@repo/factory-core/contracts/cell';
import type {
  CellRecord,
  CellStore,
  CellInfo,
} from '@repo/factory-core/ports/cells';
import {
  loadDefinitions,
  type Definitions,
} from '@repo/factory-definitions/load';
import type {
  JoinTokenRecord,
  JoinTokenStore,
} from '@repo/factory-core/ports/join-tokens';
import { DEFINITIONS_ROOT } from '../paths';
import { createRuntime, type Runtime } from '../composition';
import {
  DEFAULT_CONFIG,
  type RuntimeConfig,
  type RuntimePorts,
  type Timers,
  type WriterGuard,
} from '../ports';
import { ulidIds } from '../ids';

export const PROJECT = 'software-factory' as ProjectId;
export const REPO = 'https://example.test/software-factory.git';

let definitionsCache: Definitions | undefined;

/** The shipped definitions, read once per test process. */
export const shippedDefinitions = (): Definitions => {
  if (!definitionsCache) {
    const result = loadDefinitions(DEFINITIONS_ROOT);
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    definitionsCache = result.value;
  }
  return definitionsCache;
};

/** A timer that fires only when a test moves the clock: `advance` runs what is due. */
export interface ManualTimers extends Timers {
  advance(ms: number): void;
  pending(): number;
}

export const manualTimers = (clock: FakeClock): ManualTimers => {
  let pending: { due: number; fn: () => void; cancelled: boolean }[] = [];
  return {
    after: (ms, fn) => {
      const entry = { due: clock.now() + ms, fn, cancelled: false };
      pending.push(entry);
      return () => {
        entry.cancelled = true;
      };
    },
    advance: (ms) => {
      clock.advance(ms);
      const due = pending.filter(
        (entry) => !entry.cancelled && entry.due <= clock.now(),
      );
      pending = pending.filter(
        (entry) => !due.includes(entry) && !entry.cancelled,
      );
      for (const entry of due) entry.fn();
    },
    pending: () => pending.filter((entry) => !entry.cancelled).length,
  };
};

/** Lets queued promise continuations run; a long-poll reacts to a timer in a few microtasks. */
export const flush = async (): Promise<void> => {
  for (let index = 0; index < 20; index += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
};

export const memoryCells = (): CellStore & { all(): CellRecord[] } => {
  const records = new Map<CellId, CellRecord>();
  return {
    all: () => [...records.values()],
    hello: async ({ cellId, name, info, at }) => {
      const existing = records.get(cellId);
      records.set(cellId, {
        cellId,
        name,
        info: info as CellInfo,
        joinedAt: existing?.joinedAt ?? at,
        lastSeenAt: at,
        revokedAt: existing?.revokedAt ?? null,
      });
    },
    get: async (cellId) => records.get(cellId),
    list: async () => [...records.values()],
    touch: async (cellId, at) => {
      const record = records.get(cellId);
      if (record) records.set(cellId, { ...record, lastSeenAt: at });
    },
    revoke: async (cellId, at) => {
      const record = records.get(cellId);
      if (record && record.revokedAt === null) {
        records.set(cellId, { ...record, revokedAt: at });
      }
    },
  };
};

/** The wire Signal of a stored row: the envelope fields and the payload, without the bookkeeping. */
const toSignal = (row: NewSignal & { ackedAt: number | null }): Signal =>
  row.kind === 'answer'
    ? {
        signalId: row.signalId,
        jobId: row.jobId,
        kind: 'answer',
        questionId: row.questionId,
        text: row.text,
      }
    : {
        signalId: row.signalId,
        jobId: row.jobId,
        kind: 'nudge',
        text: row.text,
      };

/** An in-memory join token table; hashes are kept as the store receives them. */
export const memoryJoinTokens = (): JoinTokenStore & {
  all(): JoinTokenRecord[];
  hashes(): string[];
} => {
  const rows = new Map<string, JoinTokenRecord>();
  const hashes: string[] = [];
  const commands = new Set<string>();
  return {
    all: () => [...rows.values()],
    hashes: () => hashes,
    create: async ({
      joinTokenId,
      tokenHash,
      name,
      createdAt,
      expiresAt,
      commandId,
    }) => {
      hashes.push(tokenHash);
      commands.add(commandId);
      rows.set(joinTokenId, {
        joinTokenId,
        name,
        createdAt,
        expiresAt,
        revokedAt: null,
      });
    },
    createdForCommand: async (commandId) => commands.has(commandId),
    list: async () => [...rows.values()],
    revoke: async (joinTokenId, at) => {
      const row = rows.get(joinTokenId);
      if (!row) return false;
      rows.set(joinTokenId, { ...row, revokedAt: row.revokedAt ?? at });
      return true;
    },
  };
};

export const memorySignals = (): SignalStore & { all(): NewSignal[] } => {
  let rows: (NewSignal & { ackedAt: number | null })[] = [];
  return {
    all: () => rows,
    insert: async (signal) => {
      rows.push({ ...signal, ackedAt: null });
    },
    unacked: async (jobId) =>
      rows
        .filter((row) => row.jobId === jobId && row.ackedAt === null)
        .map((row) => toSignal(row)),
    ack: async (signalIds, at) => {
      rows = rows.map((row) =>
        signalIds.includes(row.signalId) && row.ackedAt === null
          ? { ...row, ackedAt: at }
          : row,
      );
    },
    deleteForJob: async (jobId) => {
      rows = rows.filter((row) => row.jobId !== jobId);
    },
  };
};

export const memoryProjects = (records: ProjectRecord[]): ProjectStore => ({
  list: async () => records,
});

/** A writer that is held until a test releases it. */
export class NotHeld extends Error {}

export const heldWriter = (): WriterGuard & { held: boolean } => {
  const guard = {
    held: true,
    assertHeld() {
      if (!guard.held) throw new NotHeld('the writer lock is not held');
    },
  };
  return guard;
};

/** Archive operations need a real database (apps/server, factory-db); a unit test must not reach them. */
const unusedArchive: ArchivePort = {
  backup: () => Promise.reject(new Error('archive is not used in this test')),
  exportTo: () => Promise.reject(new Error('archive is not used in this test')),
  importFrom: () =>
    Promise.reject(new Error('archive is not used in this test')),
  rebuildProjections: () =>
    Promise.reject(new Error('archive is not used in this test')),
};

export interface World {
  clock: FakeClock;
  timers: ManualTimers;
  events: ReturnType<typeof fakeEventStore>;
  blobs: ReturnType<typeof fakeBlobStore>;
  leases: ReturnType<typeof fakeLeaseStore>;
  cells: ReturnType<typeof memoryCells>;
  signals: ReturnType<typeof memorySignals>;
  joinTokens: ReturnType<typeof memoryJoinTokens>;
  writer: ReturnType<typeof heldWriter>;
  intake: ReturnType<typeof fakeIntakeStore>;
  git: ReturnType<typeof fakeGitMirror>;
  prState: ReturnType<typeof fakePrState>;
  ports: RuntimePorts;
  runtime: Runtime;
}

/** A runtime over in-memory ports, a manual clock and manual timers. */
export const world = (overrides: Partial<RuntimeConfig> = {}): World => {
  const clock = fakeClock(1_000_000);
  const timers = manualTimers(clock);
  const events = fakeEventStore();
  const blobs = fakeBlobStore();
  const leases = fakeLeaseStore();
  const cells = memoryCells();
  const signals = memorySignals();
  const joinTokens = memoryJoinTokens();
  const writer = heldWriter();
  const intake = fakeIntakeStore();
  const git = fakeGitMirror();
  const prState = fakePrState();
  const ports: RuntimePorts = {
    events,
    feed: events,
    archive: unusedArchive,
    intake,
    git,
    prState,
    projections: { orders: () => events.orders() },
    projects: memoryProjects([
      {
        projectId: PROJECT,
        repoUrl: REPO,
        baseBranch: 'main',
        maxRunning: 2,
        depPolicy: 'delivered',
      },
    ]),
    blobs,
    leases,
    cells,
    joinTokens,
    signals,
    clock,
    ids: ulidIds(clock as Clock),
    timers,
    writer,
    definitions: shippedDefinitions(),
    config: { ...DEFAULT_CONFIG, ...overrides },
    exportArchive: async () => new TextEncoder().encode('export-bytes'),
  };
  return {
    joinTokens,
    clock,
    timers,
    events,
    blobs,
    leases,
    cells,
    signals,
    writer,
    intake,
    git,
    prState,
    ports,
    runtime: createRuntime(ports),
  };
};

export const sha256Ref = (text: string): BlobRef =>
  `sha256:${createHash('sha256').update(text).digest('hex')}` as BlobRef;

/** Creates a Work order on a shipped Line through the command loop (the intake of v2-10 is out of scope). */
export const createOrder = async (
  w: { ports: RuntimePorts; runtime: Runtime },
  options: {
    todoId: string;
    line?: string;
    body?: string;
    priority?: 'high' | 'medium' | 'low';
  },
): Promise<OrderId> => {
  const definitions = w.ports.definitions;
  const loaded = definitions.lines.get(options.line ?? 'feature');
  if (!loaded) throw new Error(`no line ${options.line}`);
  const body = options.body ?? `Body of ${options.todoId}`;
  const bodyBlob = sha256Ref(body);
  await w.ports.blobs.put(
    bodyBlob,
    new TextEncoder().encode(body),
    'text/markdown',
  );
  const snapshotText = JSON.stringify(loaded.snapshot);
  const snapshotBlob = sha256Ref(snapshotText);
  await w.ports.blobs.put(
    snapshotBlob,
    new TextEncoder().encode(snapshotText),
    'application/json',
  );
  const orderId = orderIdOf(PROJECT, options.todoId as TodoId);
  const command: OrderCommand = {
    type: 'CreateOrder',
    projectId: PROJECT,
    todoId: options.todoId as TodoId,
    spec: {
      title: `Title ${options.todoId}`,
      type: 'feat',
      bodyBlob,
      contentHash: bodyBlob,
    },
    priority: options.priority ?? 'medium',
    dependsOn: [],
    line: {
      name: loaded.snapshot.name,
      hash: loaded.snapshot.hash,
      snapshotBlob,
      snapshot: loaded.snapshot,
    },
    baseBranch: 'main',
  };
  await w.runtime.commands.submit({
    orderId,
    commandId: `create-${options.todoId}`,
    command,
    actor: { kind: 'factory' } satisfies Actor,
  });
  return orderId;
};

/** Registers a Cell that can run every shipped runner, with the given slots. */
export const helloCell = async (
  w: { runtime: Runtime },
  cellId: CellId,
  slots = 1,
  runners = ['claude', 'cursor'],
): Promise<void> => {
  await w.runtime.call('hello', {
    cellId,
    version: '0.1.0',
    projects: [PROJECT],
    runners,
    capabilities: [],
    slots,
  });
};
