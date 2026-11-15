import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import type { Clock } from '@repo/factory-core/ports/clock';
import type { GitMirror } from '@repo/factory-core/ports/git-mirror';
import type { PrStatePort } from '@repo/factory-core/ports/pr-state';
import { sqliteArchive } from '@repo/factory-db/archive';
import { drizzleOf } from '@repo/factory-db/db';
import { sqliteCellStore } from '@repo/factory-db/cells-table';
import { sqliteSupervisorTokenStore } from '@repo/factory-db/supervisor-tokens-table';
import { exportFactory } from '@repo/factory-db/export-import';
import { sqliteIntakeStore } from '@repo/factory-db/intake-table';
import { sqliteJoinTokenStore } from '@repo/factory-db/join-tokens-table';
import { MIGRATIONS_DIR, migrate } from '@repo/factory-db/migrate';
import { rebuildOn } from '@repo/factory-db/rebuild-projections';
import {
  sqliteProjectStore,
  sqliteProjectionReader,
} from '@repo/factory-db/projects-table';
import { sqliteSignalStore } from '@repo/factory-db/signals-table';
import { sqliteBlobStore } from '@repo/factory-db/sqlite-blob-store';
import {
  openDatabase,
  openReadDatabase,
  openSqliteEventStore,
} from '@repo/factory-db/sqlite-event-store';
import { sqliteLeaseStore } from '@repo/factory-db/sqlite-lease-store';
import { acquireWriter, type WriterLock } from '@repo/factory-db/writer-lock';
import {
  loadDefinitions,
  type Definitions,
} from '@repo/factory-definitions/load';
import { createRuntime, type Runtime } from './composition';
import { projectionOf } from './admin';
import { ulidIds } from './ids';
import { DEFINITIONS_ROOT } from './paths';
import {
  DEFAULT_CONFIG,
  type RuntimeConfig,
  type RuntimePorts,
  type Timers,
} from './ports';

/** The database file inside the data directory (STORAGE §1, `factory.db`). */
export const DATABASE_FILE_NAME = 'factory.db';

/** Re-exported so a caller of `openRuntime` can tell a held directory apart without the db package. */
export { WriterHeldError } from '@repo/factory-db/writer-lock';

export interface OpenRuntimeOptions {
  /** The data directory: holds `factory.lock` and `factory.db`. */
  dataDir: string;
  definitionsRoot?: string;
  config?: Partial<RuntimeConfig>;
  clock?: Clock;
  timers?: Timers;
  /** The git mirror adapter (apps/server). Without one, intake fails with a clear message. */
  git?: GitMirror;
  /** The PR state adapter (apps/server). Without one, the PR poll fails with a clear message. */
  prState?: PrStatePort;
}

const notConfigured = (what: string): Error =>
  new Error(`${what} is not configured for this runtime`);

/** Stands in for a git mirror when the caller gave none: every use says what is missing. */
const unconfiguredGit: GitMirror = {
  sync: () => Promise.reject(notConfigured('a git mirror')),
  todoFiles: () => Promise.reject(notConfigured('a git mirror')),
  branches: () => Promise.reject(notConfigured('a git mirror')),
};

const unconfiguredPrState: PrStatePort = {
  read: () => Promise.reject(notConfigured('a PR state reader')),
  readMany: () => Promise.reject(notConfigured('a PR state reader')),
  forBranch: () => Promise.reject(notConfigured('a PR state reader')),
};

export interface OpenedRuntime {
  runtime: Runtime;
  /** The ports the runtime was built from; the same adapters the runtime writes through. */
  ports: RuntimePorts;
  writer: WriterLock;
  /** Stops the reaper, closes the database and releases the writer lock. Idempotent. */
  close(): void;
}

const systemClock: Clock = { now: () => Date.now() };

const realTimers: Timers = {
  after: (ms, fn) => {
    const handle = setTimeout(fn, ms);
    return () => clearTimeout(handle);
  },
};

/**
 * The legacy migration that adds the Order Plan columns (migrations/0003_order_plan.sql). It runs
 * only on a database older than the baseline, which then adopts the baseline without running it.
 */
const ORDER_PLAN_MIGRATION = '0003_order_plan.sql';

/**
 * Opens a Factory data directory as the single writer (STORAGE §1): takes the writer lock first, so a
 * second process is refused before the database is touched; migrates the schema; loads the
 * definitions; and composes the runtime from the SQLite adapters. The lock is released on close.
 * Throws `WriterHeldError` when another process holds the directory.
 */
export const openRuntime = (options: OpenRuntimeOptions): OpenedRuntime => {
  const writer = acquireWriter(options.dataDir);
  let database: Database | undefined;
  let readDatabase: Database | undefined;
  try {
    const file = join(options.dataDir, DATABASE_FILE_NAME);
    database = openDatabase(file);
    const applied = migrate(database, MIGRATIONS_DIR);
    // Legacy migration 0003 adds `orders.plan` and `orders.base_branch`: a rebuild fills them for existing rows (STORAGE §6).
    if (applied.includes(ORDER_PLAN_MIGRATION)) {
      rebuildOn(drizzleOf(database), projectionOf);
    }
    const definitions: Definitions = unwrapDefinitions(
      loadDefinitions(options.definitionsRoot ?? DEFINITIONS_ROOT),
    );
    const clock = options.clock ?? systemClock;
    // Reads run on their own read-only WAL connection, so a write or a sweep never queues them (STORAGE §3.1).
    readDatabase = openReadDatabase(file);
    const store = openSqliteEventStore(database, readDatabase);
    const gate = store.gate;
    const ports: RuntimePorts = {
      events: store,
      projections: sqliteProjectionReader(gate),
      projects: sqliteProjectStore(database, writer, gate),
      blobs: sqliteBlobStore(database, writer, gate),
      leases: sqliteLeaseStore(database, writer, gate),
      cells: sqliteCellStore(database, writer, gate),
      joinTokens: sqliteJoinTokenStore(database, writer, gate),
      supervisorTokens: sqliteSupervisorTokenStore(database, writer, gate),
      signals: sqliteSignalStore(database, writer, gate),
      clock,
      ids: ulidIds(clock),
      timers: options.timers ?? realTimers,
      writer,
      definitions,
      config: { ...DEFAULT_CONFIG, ...options.config },
      exportArchive: () => exportFactory(store, clock.now()),
      intake: sqliteIntakeStore(database, writer, gate),
      git: options.git ?? unconfiguredGit,
      prState: options.prState ?? unconfiguredPrState,
      feed: store,
      archive: sqliteArchive(database, store, writer),
    };
    const runtime = createRuntime(ports);
    const opened = database;
    const openedRead = readDatabase;
    return {
      runtime,
      ports,
      writer,
      close: () => {
        runtime.stop();
        openedRead.close();
        opened.close();
        writer.release();
      },
    };
  } catch (error) {
    readDatabase?.close();
    database?.close();
    writer.release();
    throw error;
  }
};

const unwrapDefinitions = (
  result: ReturnType<typeof loadDefinitions>,
): Definitions => {
  if (!result.ok) {
    const details = result.error
      .map((problem) => JSON.stringify(problem))
      .join('\n');
    throw new Error(`definitions do not load:\n${details}`);
  }
  return result.value;
};
