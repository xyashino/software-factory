import type { Database } from 'bun:sqlite';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  commitShaSchema,
  orderIdOf,
  planIdOf,
  planSlugSchema,
  projectIdSchema,
  todoIdSchema,
} from '@repo/factory-core/ids';
import { evolvePlan } from '@repo/factory-core/plan/evolve';
import type {
  PlanEvent,
  StoredPlanEvent,
} from '@repo/factory-core/plan/events';
import type { PlanState } from '@repo/factory-core/plan/state';
import type { StoredEvent } from '@repo/factory-core/order/events';
import { evolve } from '@repo/factory-core/order/evolve';
import { nextJob } from '@repo/factory-core/order/next-job';
import { toProjection } from '@repo/factory-core/order/projection';
import type { WorkOrderState } from '@repo/factory-core/order/state';
import { planNextJob } from '@repo/factory-core/plan/next-job';
import { toPlanProjection } from '@repo/factory-core/plan/projection';
import type { EventStore } from '@repo/factory-core/ports/event-store';
import type { ProjectionOf } from '@repo/factory-core/ports/archive';
import { MIGRATIONS_DIR, migrate } from '../migrate';
import { openDatabase, openSqliteEventStore } from '../sqlite-event-store';

/** The project every fixture's Work orders belong to. */
export const PROJECT_ID = 'software-factory';

/**
 * The row of a folded Work order, as the caller computes it (the store only stores it). Test code
 * may use core's projection: the boundary test covers source files, not tests.
 */
export const projectRow: ProjectionOf = {
  order: (state, meta) =>
    toProjection(state, { ...meta, next: nextJob(state) }),
  plan: (state, meta) =>
    toPlanProjection(state, { ...meta, next: planNextJob(state) }),
};

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

/** An empty directory for the log files of a test store. */
export const scratchBlobDir = (): string =>
  mkdtempSync(join(tmpdir(), 'factory-blobs-'));

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
      projection: projectRow.order(state, {
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

export const PLAN_PROJECT = projectIdSchema.parse('software-factory');
export const PLAN_SLUG = planSlugSchema.parse('xyz');
export const PLAN_ID = planIdOf(PLAN_PROJECT, PLAN_SLUG);
export const PLAN_COMMIT = commitShaSchema.parse('c'.repeat(40));

/** The three-member plan of the acceptance criteria, appended one event per command. */
export const planEvents = (): PlanEvent[] => [
  {
    type: 'plan_created',
    projectId: PLAN_PROJECT,
    slug: PLAN_SLUG,
    branch: 'feat/xyz',
    baseBranch: 'main',
  },
  {
    type: 'plan_member_added',
    orderId: orderIdOf(PLAN_PROJECT, todoIdSchema.parse('wo-1')),
    todoId: todoIdSchema.parse('wo-1'),
  },
  {
    type: 'plan_member_added',
    orderId: orderIdOf(PLAN_PROJECT, todoIdSchema.parse('wo-2')),
    todoId: todoIdSchema.parse('wo-2'),
    after: orderIdOf(PLAN_PROJECT, todoIdSchema.parse('wo-1')),
  },
  { type: 'plan_branch_created', commit: PLAN_COMMIT },
];

/** Appends the plan's events through the store, each with the core projection of its state. */
export const appendPlanHistory = async (
  store: EventStore,
  events: PlanEvent[],
): Promise<void> => {
  let state: PlanState | undefined;
  for (const [index, event] of events.entries()) {
    const seq = index + 1;
    const stored: StoredPlanEvent = {
      schemaVersion: 2,
      seq,
      globalSeq: seq,
      planId: PLAN_ID,
      at: seq * 100,
      actor: { kind: 'factory' },
      commandId: `plan-${seq}`,
      event,
    };
    state = evolvePlan(state, stored);
    const projection = toPlanProjection(state, {
      lastSeq: seq,
      createdAt: 100,
      updatedAt: seq * 100,
      next: planNextJob(state),
    });
    const result = await store.appendPlan({
      planId: PLAN_ID,
      commandId: `plan-${seq}`,
      expectedSeq: index,
      actor: { kind: 'factory' },
      at: seq * 100,
      events: [event],
      projection,
      response: { seq },
    });
    if (result.kind !== 'appended')
      throw new Error(`plan append ${seq} was ${result.kind}`);
  }
};

export const rawPlans = (db: Database): string =>
  JSON.stringify(db.query('SELECT * FROM plans ORDER BY plan_id').all());
