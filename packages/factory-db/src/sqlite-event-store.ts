import { AsyncLocalStorage } from 'node:async_hooks';
import { Database } from 'bun:sqlite';
import { asc, eq, gt } from 'drizzle-orm';
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
import { type FactoryDatabase, drizzleOf } from './db';
import { upsertOrder } from './orders-table';
import { commands, type EventRecord, events, orders } from './schema';
import { writeMutex } from './write-mutex';

/** The envelope version this store writes (CORE §11). */
const SCHEMA_VERSION = 2;

/** The columns a stored event is read back as. `type` is not needed: the payload carries it. */
const EVENT_SELECT = {
  globalSeq: events.globalSeq,
  orderId: events.orderId,
  seq: events.seq,
  at: events.at,
  actor: events.actor,
  commandId: events.commandId,
  epoch: events.epoch,
  schemaVersion: events.schemaVersion,
  payload: events.payload,
};

/** A SQLite store: the port, plus a write section the projection rebuild runs inside. */
export interface SqliteEventStore extends EventStore {
  /**
   * Runs `section` on the connection inside one write transaction, after every write already queued.
   * Only the projection rebuild uses it; `section` must not await.
   */
  exclusive<T>(section: (db: FactoryDatabase) => T): Promise<T>;
  /**
   * The statement gate the other stores of this connection run through. Outside a transaction a
   * section queues behind the write mutex; inside `transaction`, the body's own sections run at once,
   * because the body already holds the mutex. A foreign statement never joins an open transaction.
   */
  gate: StatementGate;
}

/** Runs one synchronous section of statements on the connection (see `SqliteEventStore.gate`). */
export interface StatementGate {
  run<T>(section: () => T | Promise<T>): Promise<T>;
}

/** One stored event row, as `EVENT_SELECT` reads it. */
type EventRow = Pick<EventRecord, keyof typeof EVENT_SELECT>;

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
    schemaVersion: row.schemaVersion,
    seq: row.seq,
    globalSeq: row.globalSeq,
    orderId: row.orderId,
    at: row.at,
    actor: JSON.parse(row.actor) as unknown,
    commandId: row.commandId,
    ...(row.epoch === null ? {} : { epoch: row.epoch }),
    event: JSON.parse(row.payload) as unknown,
  };
  const upcast = upcastEvent(raw);
  if (!upcast.ok) {
    throw new Error(
      `stored event ${row.globalSeq} is unreadable: ${upcast.error}`,
    );
  }
  return upcast.value;
};

const loadRows = (db: FactoryDatabase, orderId: OrderId): StoredEvent[] =>
  db
    .select(EVENT_SELECT)
    .from(events)
    .where(eq(events.orderId, orderId))
    .orderBy(asc(events.seq))
    .all()
    .map(storedOf);

/** Events after a global position, in global order. Shared with the projection rebuild. */
export const feedRows = (
  db: FactoryDatabase,
  afterGlobalSeq: number,
  limit: number,
): StoredEvent[] =>
  db
    .select(EVENT_SELECT)
    .from(events)
    .where(gt(events.globalSeq, afterGlobalSeq))
    .orderBy(asc(events.globalSeq))
    .limit(limit)
    .all()
    .map(storedOf);

/** The response a command stored, if the command ran before. */
const storedResponse = (
  db: FactoryDatabase,
  commandId: string,
): { response: string } | undefined =>
  db
    .select({ response: commands.response })
    .from(commands)
    .where(eq(commands.commandId, commandId))
    .get();

/**
 * One append inside an open write transaction (STORAGE §3 steps 1-5). Idempotency and concurrency
 * are checked first; a refusal writes nothing. The event is zod-checked before the insert and the
 * stored envelope after it, so a bad write throws and the transaction rolls back.
 */
const appendOn = (db: FactoryDatabase, input: AppendInput): AppendResult => {
  const replay = storedResponse(db, input.commandId);
  if (replay) {
    return {
      kind: 'replayed',
      response: JSON.parse(replay.response) as unknown,
    };
  }

  const currentSeq =
    db
      .select({ lastSeq: orders.lastSeq })
      .from(orders)
      .where(eq(orders.orderId, input.orderId))
      .get()?.lastSeq ?? 0;
  if (currentSeq !== input.expectedSeq) {
    return { kind: 'conflict', currentSeq };
  }

  const lastSeq = input.expectedSeq + input.events.length;
  if (input.projection.lastSeq !== lastSeq) {
    throw new Error(
      `projection lastSeq ${input.projection.lastSeq} must equal the last appended seq ${lastSeq}`,
    );
  }

  const stored = input.events.map((event: OrderEvent, index) => {
    orderEventSchema.parse(event);
    const seq = input.expectedSeq + index + 1;
    const inserted = db
      .insert(events)
      .values({
        orderId: input.orderId,
        seq,
        at: input.at,
        actor: JSON.stringify(input.actor),
        commandId: input.commandId,
        epoch: input.epoch ?? null,
        schemaVersion: SCHEMA_VERSION,
        type: event.type,
        payload: JSON.stringify(event),
      })
      .returning({ globalSeq: events.globalSeq })
      .get();
    return storedEventSchema.parse({
      schemaVersion: SCHEMA_VERSION,
      seq,
      globalSeq: inserted?.globalSeq,
      orderId: input.orderId,
      at: input.at,
      actor: input.actor,
      commandId: input.commandId,
      ...(input.epoch !== undefined ? { epoch: input.epoch } : {}),
      event,
    });
  });

  upsertOrder(db, input.projection);
  db.insert(commands)
    .values({
      commandId: input.commandId,
      orderId: input.orderId,
      firstSeq: input.expectedSeq + 1,
      lastSeq,
      response: JSON.stringify(input.response ?? null),
      at: input.at,
    })
    .run();
  return { kind: 'appended', events: stored };
};

/**
 * Runs one `tx.append` in a savepoint, so a failing append leaves the outer transaction usable.
 * Savepoints are raw SQL on the connection; Drizzle runs the statements inside them.
 */
const appendInSavepoint = (
  raw: Database,
  db: FactoryDatabase,
  input: AppendInput,
): AppendResult => {
  raw.exec('SAVEPOINT append');
  try {
    const result = appendOn(db, input);
    raw.exec('RELEASE append');
    return result;
  } catch (error) {
    raw.exec('ROLLBACK TO append');
    raw.exec('RELEASE append');
    throw error;
  }
};

/**
 * The SQLite `EventStore` over one connection. Every statement, reads included, runs under one
 * in-process write mutex, and every write runs inside `BEGIN IMMEDIATE` (STORAGE §3.1). The schema
 * must already be migrated (`migrate`).
 */
export const openSqliteEventStore = (db: Database): SqliteEventStore => {
  const orm = drizzleOf(db);
  const writes = writeMutex();
  // Marks the async context of a transaction body, so `gate` can tell its own sections from others'.
  const inTransaction = new AsyncLocalStorage<true>();

  const gate: StatementGate = {
    run: <T>(section: () => T | Promise<T>): Promise<T> =>
      inTransaction.getStore()
        ? Promise.resolve().then(section)
        : writes.run(async () => section()),
  };

  const inWriteTransaction = <T>(body: () => Promise<T>): Promise<T> =>
    writes.run(() =>
      inTransaction.run(true, async () => {
        db.exec('BEGIN IMMEDIATE');
        try {
          const value = await body();
          db.exec('COMMIT');
          return value;
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      }),
    );

  const transaction = <T>(fn: (tx: StoreTx) => Promise<T>): Promise<T> =>
    inWriteTransaction(() => {
      const tx: StoreTx = {
        load: async (orderId) => loadRows(orm, orderId),
        append: async (input) => appendInSavepoint(db, orm, input),
      };
      return fn(tx);
    });

  return {
    load: (orderId) => writes.run(async () => loadRows(orm, orderId)),
    response: (commandId) =>
      writes.run(async () => {
        const row = storedResponse(orm, commandId);
        return row
          ? { response: JSON.parse(row.response) as unknown }
          : undefined;
      }),
    feed: (afterGlobalSeq, limit) =>
      writes.run(async () => feedRows(orm, afterGlobalSeq, limit)),
    append: (input) => transaction((tx) => tx.append(input)),
    transaction,
    exclusive: (section) => inWriteTransaction(async () => section(orm)),
    gate,
  };
};
