import type { Database } from 'bun:sqlite';
import type { StoredEvent } from '@repo/factory-core/order/events';
import { evolve } from '@repo/factory-core/order/evolve';
import { nextJob } from '@repo/factory-core/order/next-job';
import { toProjection } from '@repo/factory-core/order/projection';
import type { WorkOrderState } from '@repo/factory-core/order/state';
import type { EventStore } from '@repo/factory-core/ports/event-store';
import { MIGRATIONS_DIR, migrate } from '../migrate';
import type { ProjectRow } from '../rebuild-projections';
import { openDatabase, openSqliteEventStore } from '../sqlite-event-store';

/** The project every fixture's Work orders belong to. */
export const PROJECT_ID = 'software-factory';

/**
 * The row of a folded Work order, as the caller computes it (the store only stores it). Test code
 * may use core's projection: the boundary test covers source files, not tests.
 */
export const projectRow: ProjectRow = (state, meta) =>
  toProjection(state, { ...meta, next: nextJob(state) });

/** A migrated database, with the project row Work orders need. */
export const openMigratedDatabase = (file = ':memory:'): Database => {
  const db = openDatabase(file);
  migrate(db, MIGRATIONS_DIR);
  return db;
};

export const seedProject = (db: Database): void => {
  db.run(
    'INSERT INTO projects (project_id, repo_url, created_at) VALUES (?, ?, ?)',
    [PROJECT_ID, 'https://example.test/software-factory.git', 0],
  );
};

/** A fresh store over a migrated, seeded in-memory database. */
export const openSeededStore = () => {
  const db = openMigratedDatabase();
  seedProject(db);
  return { db, store: openSqliteEventStore(db) };
};

/** Folds events of one Work order into its state. */
export const foldAll = (events: readonly StoredEvent[]): WorkOrderState => {
  let state: WorkOrderState | undefined;
  for (const stored of events) {
    state = evolve(state, stored);
  }
  if (!state) throw new Error('empty history');
  return state;
};

/** The events of a fixture, grouped by commandId: one append per command, as the Factory writes. */
const commandBatches = (events: readonly StoredEvent[]): StoredEvent[][] =>
  events.reduce<StoredEvent[][]>((batches, stored) => {
    const last = batches[batches.length - 1];
    if (last && last[0]?.commandId === stored.commandId) {
      last.push(stored);
    } else {
      batches.push([stored]);
    }
    return batches;
  }, []);

/**
 * Writes a history through the store, one append per command, each with the projection of the
 * state after it. Every append must be accepted.
 */
export const appendHistory = async (
  store: EventStore,
  events: readonly StoredEvent[],
): Promise<void> => {
  const createdAt = events[0]?.at ?? 0;
  let state: WorkOrderState | undefined;
  for (const batch of commandBatches(events)) {
    const first = batch[0];
    const last = batch[batch.length - 1];
    if (!first || !last) continue;
    for (const stored of batch) {
      state = evolve(state, stored);
    }
    if (!state) throw new Error('a fixture starts with order_created');
    const result = await store.append({
      orderId: first.orderId,
      commandId: first.commandId,
      expectedSeq: first.seq - 1,
      actor: first.actor,
      epoch: first.epoch,
      at: first.at,
      events: batch.map((stored) => stored.event),
      projection: projectRow(state, {
        lastSeq: last.seq,
        createdAt,
        updatedAt: first.at,
      }),
      response: null,
    });
    if (result.kind !== 'appended') {
      throw new Error(`fixture append refused: ${result.kind}`);
    }
  }
};

/** Every `orders` row exactly as SQLite stores it, for byte-for-byte comparison. */
export const rawOrders = (db: Database): string =>
  JSON.stringify(db.query('SELECT * FROM orders ORDER BY order_id').all());
