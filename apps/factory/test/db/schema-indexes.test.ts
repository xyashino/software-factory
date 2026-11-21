import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  asCellId,
  asCommandId,
  asOrderId,
  asProjectId,
} from '../../src/domain/common/brand';
import { stateTransitions } from '../../src/db/schema/transitions';
import { workOrders } from '../../src/db/schema/orders';
import { createTestDb, insertJob, seedBaseline } from '../support/test-db';
import type { Db } from '../../src/db/client';

const TABLES = [
  'projects',
  'safe_tokens',
  'cells',
  'order_plans',
  'work_orders',
  'order_steps',
  'jobs',
  'incidents',
  'state_transitions',
];

const PARTIAL_INDEXES = [
  'idx_jobs_one_active_per_order',
  'idx_jobs_one_active_per_cell',
  'idx_work_orders_one_active_per_cell',
];

const schemaObjects = (db: Db, type: 'table' | 'index') =>
  db.all<{ name: string; sql: string | null }>(
    sql`SELECT name, sql FROM sqlite_master WHERE type = ${type}`,
  );

const messageChain = (error: unknown): string => {
  if (!(error instanceof Error)) return String(error);
  const cause =
    error.cause === undefined ? '' : ` ${messageChain(error.cause)}`;
  return `${error.message}${cause}`;
};

const expectUniqueViolation = (action: () => void) => {
  let caught: unknown;
  try {
    action();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeDefined();
  expect(messageChain(caught)).toMatch(/UNIQUE constraint failed/);
};

describe('database schema', () => {
  it('creates every table the plan lists', () => {
    const db = createTestDb();

    const names = schemaObjects(db, 'table').map((row) => row.name);

    expect(names).toEqual(expect.arrayContaining(TABLES));
  });

  it('declares the three partial unique indexes that cap one active Cell', () => {
    const db = createTestDb();

    const indexes = schemaObjects(db, 'index');

    for (const name of PARTIAL_INDEXES) {
      const index = indexes.find((row) => row.name === name);
      expect(index?.sql).toMatch(/CREATE UNIQUE INDEX/);
      expect(index?.sql).toMatch(/WHERE/);
    }
  });

  it('rejects a second claimed job for the same order', () => {
    const db = createTestDb();
    seedBaseline(db);
    insertJob(db, 'job-1', 'order-1', 'cell-1', 'claimed');

    expectUniqueViolation(() =>
      insertJob(db, 'job-2', 'order-1', 'cell-2', 'running'),
    );
  });

  it('rejects a second active job on the same cell', () => {
    const db = createTestDb();
    seedBaseline(db);
    insertJob(db, 'job-1', 'order-1', 'cell-1', 'claimed');

    expectUniqueViolation(() =>
      insertJob(db, 'job-2', 'order-2', 'cell-1', 'claimed'),
    );
  });

  it('allows a cell to run again once its earlier job has passed', () => {
    const db = createTestDb();
    seedBaseline(db);
    insertJob(db, 'job-1', 'order-1', 'cell-1', 'passed');

    expect(() =>
      insertJob(db, 'job-2', 'order-2', 'cell-1', 'claimed'),
    ).not.toThrow();
  });

  it('rejects two work orders locked to the same active cell', () => {
    const db = createTestDb();
    seedBaseline(db);
    db.update(workOrders)
      .set({ activeCellId: asCellId('cell-1') })
      .where(sql`${workOrders.orderId} = ${'order-1'}`)
      .run();

    expectUniqueViolation(() =>
      db
        .update(workOrders)
        .set({ activeCellId: asCellId('cell-1') })
        .where(sql`${workOrders.orderId} = ${'order-2'}`)
        .run(),
    );
  });

  it('rejects a repeated command id in the transition log', () => {
    const db = createTestDb();
    seedBaseline(db);
    const transition = {
      projectId: asProjectId('proj-1'),
      entityType: 'job' as const,
      entityId: 'job-1',
      fromState: 'ready',
      toState: 'claimed',
      actorKind: 'cell' as const,
      actorId: 'cell-1',
      commandId: asCommandId('cmd-1'),
      meta: null,
      at: 1,
    };
    db.insert(stateTransitions).values(transition).run();

    expectUniqueViolation(() =>
      db.insert(stateTransitions).values(transition).run(),
    );
  });

  it('keeps the order id reachable for the order-scoped unique index', () => {
    const db = createTestDb();
    seedBaseline(db);

    const rows = db
      .select({ orderId: workOrders.orderId })
      .from(workOrders)
      .where(sql`${workOrders.orderId} = ${asOrderId('order-1')}`)
      .all();

    expect(rows).toEqual([{ orderId: 'order-1' }]);
  });
});
