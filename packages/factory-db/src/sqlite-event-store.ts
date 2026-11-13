import { Database } from 'bun:sqlite';
import type { OrderId } from '@repo/factory-core/ids';
import {
  type OrderEvent,
  type StoredEvent,
  orderEventSchema,
  storedEventSchema,
} from '@repo/factory-core/order/events';
import { upcastEvent } from '@repo/factory-core/order/upcast';
import type {
  AppendInput,
  AppendResult,
  EventStore,
  StoreTx,
} from '@repo/factory-core/ports/event-store';
import { upsertOrder } from './orders-table';
import { writeMutex } from './write-mutex';

/** The envelope version this store writes (CORE §11). */
const SCHEMA_VERSION = 2;

const EVENT_COLUMNS =
  'global_seq, order_id, seq, at, actor, command_id, epoch, schema_version, payload';

/** A SQLite store: the port, plus a write section the projection rebuild runs inside. */
export interface SqliteEventStore extends EventStore {
  /**
   * Runs `section` on the connection inside one write transaction, after every write already queued.
   * Only the projection rebuild uses it; `section` must not await.
   */
  exclusive<T>(section: (db: Database) => T): Promise<T>;
}

interface EventRow {
  global_seq: number;
  order_id: string;
  seq: number;
  at: number;
  actor: string;
  command_id: string;
  epoch: number | null;
  schema_version: number;
  payload: string;
}

/** Opens (or creates) a database file in WAL mode with foreign keys and a busy timeout. */
export const openDatabase = (file: string): Database => {
  const db = new Database(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  return db;
};

/** A stored row back to the current envelope. A row that does not upcast is an error, never skipped. */
const storedOf = (row: EventRow): StoredEvent => {
  const raw = {
    schemaVersion: row.schema_version,
    seq: row.seq,
    globalSeq: row.global_seq,
    orderId: row.order_id,
    at: row.at,
    actor: JSON.parse(row.actor) as unknown,
    commandId: row.command_id,
    ...(row.epoch === null ? {} : { epoch: row.epoch }),
    event: JSON.parse(row.payload) as unknown,
  };
  const upcast = upcastEvent(raw);
  if (!upcast.ok) {
    throw new Error(
      `stored event ${row.global_seq} is unreadable: ${upcast.error}`,
    );
  }
  return upcast.value;
};

const loadRows = (db: Database, orderId: OrderId): StoredEvent[] =>
  db
    .query<EventRow, [string]>(
      `SELECT ${EVENT_COLUMNS} FROM events WHERE order_id = ? ORDER BY seq`,
    )
    .all(orderId)
    .map(storedOf);

/** Events after a global position, in global order. Shared with the projection rebuild. */
export const feedRows = (
  db: Database,
  afterGlobalSeq: number,
  limit: number,
): StoredEvent[] =>
  db
    .query<EventRow, [number, number]>(
      `SELECT ${EVENT_COLUMNS} FROM events WHERE global_seq > ? ORDER BY global_seq LIMIT ?`,
    )
    .all(afterGlobalSeq, limit)
    .map(storedOf);

/**
 * One append inside an open write transaction (STORAGE §3 steps 1-5). Idempotency and concurrency
 * are checked first; a refusal writes nothing. The event is zod-checked before the insert and the
 * stored envelope after it, so a bad write throws and the transaction rolls back.
 */
const appendOn = (db: Database, input: AppendInput): AppendResult => {
  const replay = db
    .query<{ response: string }, [string]>(
      'SELECT response FROM commands WHERE command_id = ?',
    )
    .get(input.commandId);
  if (replay) {
    return {
      kind: 'replayed',
      response: JSON.parse(replay.response) as unknown,
    };
  }

  const currentSeq =
    db
      .query<{ last_seq: number }, [string]>(
        'SELECT last_seq FROM orders WHERE order_id = ?',
      )
      .get(input.orderId)?.last_seq ?? 0;
  if (currentSeq !== input.expectedSeq) {
    return { kind: 'conflict', currentSeq };
  }

  const lastSeq = input.expectedSeq + input.events.length;
  if (input.projection.lastSeq !== lastSeq) {
    throw new Error(
      `projection lastSeq ${input.projection.lastSeq} must equal the last appended seq ${lastSeq}`,
    );
  }

  const insertEvent = db.query<
    { global_seq: number },
    (string | number | null)[]
  >(
    `INSERT INTO events (order_id, seq, at, actor, command_id, epoch, schema_version, type, payload)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING global_seq`,
  );
  const stored = input.events.map((event: OrderEvent, index) => {
    orderEventSchema.parse(event);
    const seq = input.expectedSeq + index + 1;
    const inserted = insertEvent.get(
      input.orderId,
      seq,
      input.at,
      JSON.stringify(input.actor),
      input.commandId,
      input.epoch ?? null,
      SCHEMA_VERSION,
      event.type,
      JSON.stringify(event),
    );
    return storedEventSchema.parse({
      schemaVersion: SCHEMA_VERSION,
      seq,
      globalSeq: inserted?.global_seq,
      orderId: input.orderId,
      at: input.at,
      actor: input.actor,
      commandId: input.commandId,
      ...(input.epoch !== undefined ? { epoch: input.epoch } : {}),
      event,
    });
  });

  upsertOrder(db, input.projection);
  db.run(
    'INSERT INTO commands (command_id, order_id, first_seq, last_seq, response, at) VALUES (?, ?, ?, ?, ?, ?)',
    [
      input.commandId,
      input.orderId,
      input.expectedSeq + 1,
      lastSeq,
      JSON.stringify(input.response ?? null),
      input.at,
    ],
  );
  return { kind: 'appended', events: stored };
};

/** Runs one `tx.append` in a savepoint, so a failing append leaves the outer transaction usable. */
const appendInSavepoint = (db: Database, input: AppendInput): AppendResult => {
  db.exec('SAVEPOINT append');
  try {
    const result = appendOn(db, input);
    db.exec('RELEASE append');
    return result;
  } catch (error) {
    db.exec('ROLLBACK TO append');
    db.exec('RELEASE append');
    throw error;
  }
};

/**
 * The SQLite `EventStore` over one connection. Every statement, reads included, runs under one
 * in-process write mutex, and every write runs inside `BEGIN IMMEDIATE` (STORAGE §3.1). The schema
 * must already be migrated (`migrate`).
 */
export const openSqliteEventStore = (db: Database): SqliteEventStore => {
  const writes = writeMutex();

  const inWriteTransaction = <T>(body: () => Promise<T>): Promise<T> =>
    writes.run(async () => {
      db.exec('BEGIN IMMEDIATE');
      try {
        const value = await body();
        db.exec('COMMIT');
        return value;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    });

  const transaction = <T>(fn: (tx: StoreTx) => Promise<T>): Promise<T> =>
    inWriteTransaction(() => {
      const tx: StoreTx = {
        load: async (orderId) => loadRows(db, orderId),
        append: async (input) => appendInSavepoint(db, input),
      };
      return fn(tx);
    });

  return {
    load: (orderId) => writes.run(async () => loadRows(db, orderId)),
    feed: (afterGlobalSeq, limit) =>
      writes.run(async () => feedRows(db, afterGlobalSeq, limit)),
    append: (input) => transaction((tx) => tx.append(input)),
    transaction,
    exclusive: (section) => inWriteTransaction(async () => section(db)),
  };
};
