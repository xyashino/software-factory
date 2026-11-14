import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import type { Clock } from '@repo/factory-core/ports/clock';
import { MIGRATIONS_DIR, migrate } from '@repo/factory-db/migrate';
import { sqliteBlobStore } from '@repo/factory-db/sqlite-blob-store';
import { sqliteLeaseStore } from '@repo/factory-db/sqlite-lease-store';
import {
  openDatabase,
  openSqliteEventStore,
} from '@repo/factory-db/sqlite-event-store';
import { sqliteSignalStore } from '@repo/factory-db/signals-table';
import {
  sqliteProjectStore,
  sqliteProjectionReader,
} from '@repo/factory-db/projects-table';
import { sqliteCellStore } from '@repo/factory-db/cells-table';
import { acquireWriter, type WriterLock } from '@repo/factory-db/writer-lock';
import {
  loadDefinitions,
  type Definitions,
} from '@repo/factory-definitions/load';
import { createRuntime, type Runtime } from './composition';
import { ulidIds } from './ids';
import {
  DEFAULT_CONFIG,
  type RuntimeConfig,
  type RuntimePorts,
  type Timers,
} from './ports';
import { DEFINITIONS_ROOT } from './paths';

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
}

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
 * Opens a Factory data directory as the single writer (STORAGE §1): takes the writer lock first, so a
 * second process is refused before the database is touched; migrates the schema; loads the
 * definitions; and composes the runtime from the SQLite adapters. The lock is released on close.
 * Throws `WriterHeldError` when another process holds the directory.
 */
export const openRuntime = (options: OpenRuntimeOptions): OpenedRuntime => {
  const writer = acquireWriter(options.dataDir);
  let database: Database | undefined;
  try {
    database = openDatabase(join(options.dataDir, DATABASE_FILE_NAME));
    migrate(database, MIGRATIONS_DIR);
    const definitions: Definitions = unwrapDefinitions(
      loadDefinitions(options.definitionsRoot ?? DEFINITIONS_ROOT),
    );
    const clock = options.clock ?? systemClock;
    const store = openSqliteEventStore(database);
    const gate = store.gate;
    const ports: RuntimePorts = {
      events: store,
      projections: sqliteProjectionReader(database, gate),
      projects: sqliteProjectStore(database, gate),
      blobs: sqliteBlobStore(database, writer, gate),
      leases: sqliteLeaseStore(database, writer, gate),
      cells: sqliteCellStore(database, writer, gate),
      signals: sqliteSignalStore(database, writer, gate),
      clock,
      ids: ulidIds(clock),
      timers: options.timers ?? realTimers,
      writer,
      definitions,
      config: { ...DEFAULT_CONFIG, ...options.config },
    };
    const runtime = createRuntime(ports);
    const opened = database;
    return {
      runtime,
      ports,
      writer,
      close: () => {
        runtime.stop();
        opened.close();
        writer.release();
      },
    };
  } catch (error) {
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
