import type { Database } from 'bun:sqlite';
import { and, asc, eq, notInArray, sql } from 'drizzle-orm';
import type { ProjectId } from '@repo/factory-core/ids';
import type {
  ProjectPatch,
  ProjectStore,
  ProjectStoreResult,
} from '@repo/factory-core/ports/projects';
import type { ProjectionReader } from '@repo/factory-core/ports/projection-reader';
import type { OrderProjection } from '@repo/factory-core/order/projection';
import type { PlanProjection } from '@repo/factory-core/plan/projection';
import { drizzleOf, type FactoryDatabase } from './db';
import { loadOrders } from './orders-table';
import { loadPlans } from './plans-table';
import { events, orders, projects } from './schema';
import type { StatementGate } from './sqlite-event-store';
import type { WriterLock } from './writer-lock';

// The Work order statuses after which a base branch is no longer held.
const TERMINAL_STATUSES = ['delivered', 'merged', 'cancelled'];

type ProjectRow = typeof projects.$inferSelect;

const refused = (
  reason: 'missing' | 'has_history' | 'base_branch_busy' | 'exists',
): ProjectStoreResult => ({
  ok: false,
  reason,
});

const rowOf = (
  orm: FactoryDatabase,
  projectId: string,
): ProjectRow | undefined =>
  orm.select().from(projects).where(eq(projects.projectId, projectId)).get();

const hasHistory = (orm: FactoryDatabase, projectId: string): boolean => {
  const eventPrefix = `${projectId}:`;
  const hasOrder =
    orm
      .select({ one: sql`1` })
      .from(orders)
      .where(eq(orders.projectId, projectId))
      .limit(1)
      .get() !== undefined;
  // `substr` prefix match, not LIKE: LIKE would read `_` and `%` in a project id as wildcards.
  const hasEvent =
    orm
      .select({ one: sql`1` })
      .from(events)
      .where(
        sql`substr(${events.orderId}, 1, length(${eventPrefix})) = ${eventPrefix}`,
      )
      .limit(1)
      .get() !== undefined;
  return hasOrder || hasEvent;
};

// True when a Work order of the project is not terminal, so it runs on the base branch now.
const holdsBaseBranch = (orm: FactoryDatabase, projectId: string): boolean =>
  orm
    .select({ one: sql`1` })
    .from(orders)
    .where(
      and(
        eq(orders.projectId, projectId),
        notInArray(orders.status, TERMINAL_STATUSES),
      ),
    )
    .limit(1)
    .get() !== undefined;

/**
 * The `projects` table behind `ProjectStore`. Reads run on the WAL read connection;
 * writes assert the writer lock and run inside the statement gate, so the check and the write form
 * one synchronous section: a refusal changes nothing.
 */
export const sqliteProjectStore = (
  db: Database,
  writer: WriterLock,
  gate: StatementGate,
): ProjectStore => {
  const orm = drizzleOf(db);
  return {
    list: () =>
      gate.read((reader) =>
        reader
          .select()
          .from(projects)
          .orderBy(asc(projects.projectId))
          .all()
          .map((row) => ({
            projectId: row.projectId as ProjectId,
            repoUrl: row.repoUrl,
            baseBranch: row.baseBranch,
            maxRunning: row.maxRunning,
            depPolicy: row.depPolicy,
          })),
      ),
    add: (project, createdAt) =>
      gate.run((): ProjectStoreResult => {
        writer.assertHeld();
        if (rowOf(orm, project.projectId)) return refused('exists');
        orm
          .insert(projects)
          .values({
            projectId: project.projectId,
            repoUrl: project.repoUrl,
            baseBranch: project.baseBranch,
            maxRunning: project.maxRunning,
            depPolicy: project.depPolicy,
            createdAt,
          })
          .run();
        return { ok: true };
      }),
    set: (projectId, patch: ProjectPatch) =>
      gate.run((): ProjectStoreResult => {
        writer.assertHeld();
        const current = rowOf(orm, projectId);
        if (!current) return refused('missing');
        const changesBase =
          patch.baseBranch !== undefined &&
          patch.baseBranch !== current.baseBranch;
        if (changesBase && holdsBaseBranch(orm, projectId)) {
          return refused('base_branch_busy');
        }
        orm
          .update(projects)
          .set({
            baseBranch: patch.baseBranch ?? current.baseBranch,
            maxRunning: patch.maxRunning ?? current.maxRunning,
            depPolicy: patch.depPolicy ?? current.depPolicy,
          })
          .where(eq(projects.projectId, projectId))
          .run();
        return { ok: true };
      }),
    remove: (projectId) =>
      gate.run((): ProjectStoreResult => {
        writer.assertHeld();
        if (!rowOf(orm, projectId)) return refused('missing');
        if (hasHistory(orm, projectId)) return refused('has_history');
        orm.delete(projects).where(eq(projects.projectId, projectId)).run();
        return { ok: true };
      }),
  };
};

/**
 * The `orders` and `plans` projections as a reader port. Rows are read as stored; nothing is folded
 * here. Both run on the gate's read connection, so a read is not queued behind a write.
 */
export const sqliteProjectionReader = (
  gate: StatementGate,
): ProjectionReader => ({
  orders: (): Promise<OrderProjection[]> => gate.read(loadOrders),
  plans: (): Promise<PlanProjection[]> => gate.read(loadPlans),
});
