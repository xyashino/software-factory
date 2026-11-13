import { Database } from 'bun:sqlite';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, asc, eq, gt, inArray } from 'drizzle-orm';
import { drizzle, type BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { z } from 'zod';
import { factoryEventSchema, type FactoryEvent } from '../../engine/events';
import { TASK_STATUSES, type TaskStatus } from '../../engine/state';
import type { ClockPort } from '../../ports/clock.port';
import { findRunningAttempt } from '../../ports/running-attempt';
import {
  type AttemptLookup,
  type NewTask,
  type StorePort,
  type StoredEvent,
  type TaskRow,
} from '../../ports/store.port';
import * as schema from './schema';
import { events, tasks, type EventRecord, type TaskRecord } from './schema';

const DEFAULT_MIGRATIONS_DIR = fileURLToPath(
  new URL('../../../migrations', import.meta.url),
);

const taskStatusSchema = z.enum(TASK_STATUSES);

/** A stored event whose payload no longer matches the schema. Names the row so it can be found. */
export class EventPayloadError extends Error {
  readonly seq: number;

  constructor(seq: number, reason: string) {
    super(`event seq ${seq} is invalid: ${reason}`);
    this.name = 'EventPayloadError';
    this.seq = seq;
  }
}

export interface SqliteStoreOptions {
  path: string;
  clock: ClockPort;
  migrationsDir?: string;
}

export interface ConnectionSettings {
  journalMode: string;
  busyTimeout: number;
  foreignKeys: boolean;
}

/**
 * Append-only event store on `bun:sqlite`, queried through Drizzle. Opens in WAL mode with a
 * busy timeout so several processes (supervisor and in-pane CLI) can write at once.
 */
export class SqliteStore implements StorePort {
  private readonly db: Database;
  private readonly drizzle: BunSQLiteDatabase<typeof schema>;
  private readonly clock: ClockPort;

  constructor(options: SqliteStoreOptions) {
    this.clock = options.clock;
    if (options.path !== ':memory:') {
      mkdirSync(dirname(options.path), { recursive: true });
    }
    this.db = new Database(options.path, { create: true });
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA busy_timeout = 5000');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.drizzle = drizzle(this.db, { schema });
    migrate(
      this.db,
      options.migrationsDir ?? DEFAULT_MIGRATIONS_DIR,
      this.clock.now(),
    );
  }

  close(): void {
    this.db.close();
  }

  /** The connection settings in effect, for checks and diagnostics. */
  connectionSettings(): ConnectionSettings {
    const journal = this.db
      .query<{ journal_mode: string }, []>('PRAGMA journal_mode')
      .get();
    const busy = this.db
      .query<{ timeout: number }, []>('PRAGMA busy_timeout')
      .get();
    const fk = this.db
      .query<{ foreign_keys: number }, []>('PRAGMA foreign_keys')
      .get();
    return {
      journalMode: journal?.journal_mode ?? '',
      busyTimeout: busy?.timeout ?? 0,
      foreignKeys: fk?.foreign_keys === 1,
    };
  }

  createTask(input: NewTask): void {
    const now = this.clock.now();
    this.drizzle
      .insert(tasks)
      .values({
        id: input.taskId,
        workflow: input.workflow,
        todoPath: input.todoPath,
        branch: input.branch,
        status: 'setting_up',
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  append(taskId: string, event: FactoryEvent): StoredEvent {
    const parsed = factoryEventSchema.parse(event);
    const at = this.clock.now();
    const attemptId = 'attemptId' in parsed ? parsed.attemptId : null;
    const [inserted] = this.drizzle
      .insert(events)
      .values({
        taskId,
        attemptId,
        type: parsed.type,
        payload: JSON.stringify(parsed),
        at,
      })
      .returning({ seq: events.seq })
      .all();
    if (inserted === undefined) {
      throw new Error(`event for task "${taskId}" was not stored`);
    }
    return {
      seq: inserted.seq,
      taskId,
      at,
      event: parsed,
    };
  }

  events(taskId: string): StoredEvent[] {
    return this.drizzle
      .select()
      .from(events)
      .where(eq(events.taskId, taskId))
      .orderBy(asc(events.seq))
      .all()
      .map(decodeEvent);
  }

  eventsSince(seq: number): StoredEvent[] {
    return this.drizzle
      .select()
      .from(events)
      .where(gt(events.seq, seq))
      .orderBy(asc(events.seq))
      .all()
      .map(decodeEvent);
  }

  tasks(filter?: { status?: TaskStatus[] }): TaskRow[] {
    if (filter?.status === undefined) {
      return this.listTasks();
    }
    if (filter.status.length === 0) return [];
    return this.listTasks(filter.status);
  }

  setTaskStatus(taskId: string, status: TaskStatus): void {
    const updated = this.drizzle
      .update(tasks)
      .set({ status, updatedAt: this.clock.now() })
      .where(eq(tasks.id, taskId))
      .returning({ id: tasks.id })
      .all();
    if (updated.length === 0) {
      throw new Error(`unknown task "${taskId}"`);
    }
  }

  runningAttempt(taskId: string, attemptId: string): AttemptLookup | undefined {
    const rows = this.drizzle
      .select()
      .from(events)
      .where(and(eq(events.taskId, taskId), eq(events.attemptId, attemptId)))
      .orderBy(asc(events.seq))
      .all();
    return findRunningAttempt(rows.map(decodeEvent), attemptId);
  }

  private listTasks(statuses?: TaskStatus[]): TaskRow[] {
    const query = this.drizzle.select().from(tasks);
    const filtered =
      statuses === undefined
        ? query
        : query.where(inArray(tasks.status, statuses));
    return filtered
      .orderBy(asc(tasks.createdAt), asc(tasks.id))
      .all()
      .map(toTaskRow);
  }
}

/** Parses a stored row. Any payload that fails the schema is an error, never a silent skip. */
const decodeEvent = (row: EventRecord): StoredEvent => {
  let json: unknown;
  try {
    json = JSON.parse(row.payload);
  } catch {
    throw new EventPayloadError(row.seq, 'payload is not JSON');
  }
  const parsed = factoryEventSchema.safeParse(json);
  if (!parsed.success) {
    throw new EventPayloadError(row.seq, parsed.error.message);
  }
  if (parsed.data.type !== row.type) {
    throw new EventPayloadError(
      row.seq,
      `type column "${row.type}" disagrees with payload`,
    );
  }
  return {
    seq: row.seq,
    taskId: row.taskId,
    at: row.at,
    event: parsed.data,
  };
};

const toTaskRow = (row: TaskRecord): TaskRow => {
  return {
    id: row.id,
    workflow: row.workflow,
    todoPath: row.todoPath,
    branch: row.branch,
    status: taskStatusSchema.parse(row.status),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
};

interface MigrationFile {
  version: number;
  path: string;
}

/** Applies every `NNNN_*.sql` above the highest recorded version, one transaction per file. */
const migrate = (db: Database, dir: string, appliedAt: number): void => {
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)',
  );
  const applied = new Set(
    db
      .query<{ version: number }, []>('SELECT version FROM schema_migrations')
      .all()
      .map((row) => row.version),
  );
  for (const migration of listMigrations(dir)) {
    if (applied.has(migration.version)) continue;
    const sql = readFileSync(migration.path, 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.query(
        'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)',
      ).run(migration.version, appliedAt);
    })();
  }
};

const listMigrations = (dir: string): MigrationFile[] => {
  return readdirSync(dir)
    .map((name): MigrationFile | undefined => {
      const match = /^(\d{4})_.+\.sql$/.exec(name);
      if (match === null) return undefined;
      return { version: Number(match[1]), path: join(dir, name) };
    })
    .filter((file): file is MigrationFile => file !== undefined)
    .sort((a, b) => a.version - b.version);
};
