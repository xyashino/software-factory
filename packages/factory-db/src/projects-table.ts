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
import { drizzleOf, type FactoryDatabase } from './db';
import { loadOrders } from './orders-table';
import { loadPlans } from './plans-table';
import type { PlanProjection } from '@repo/factory-core/plan/projection';
import { events, intake, orders, projects } from './schema';
import type { StatementGate } from './sqlite-event-store';
import type { WriterLock } from './writer-lock';

/** The Work order statuses after which a base branch is no longer held (CORE §4.2). */
const TERMINAL_STATUSES = ['delivered', 'merged', 'cancelled'];

type ProjectRow = typeof projects.$inferSelect;

const refused = (
  reason: 'missing' | 'has_history' | 'base_branch_busy' | 'exists',
): ProjectStoreResult => ({
  ok: false,
  reason,
});

/** The `projects` row of one id, or undefined. */
const rowOf = (
  orm: FactoryDatabase,
  projectId: string,
): ProjectRow | undefined =>
  orm.select().from(projects).where(eq(projects.projectId, projectId)).get();

/**
 * True when the project has any Work order, event or intake row. Events belong to a project through
 * their order id, which is `<projectId>:<todoId>` (core `orderIdOf`).
 */
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
  const hasIntake =
    orm
      .select({ one: sql`1` })
      .from(intake)
      .where(eq(intake.projectId, projectId))
      .limit(1)
      .get() !== undefined;
  return hasOrder || hasEvent || hasIntake;
};

/** True when a Work order of the project is not terminal, so it runs on the base branch now. */
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
 * The `projects` table behind `ProjectStore` (STORAGE §4). Reads run as they always did. Writes assert
 * the writer lock and run inside the statement gate, so the check and the write form one synchronous
 * section: a refusal changes nothing.
 */
export const sqliteProjectStore = (
  db: Database,
  writer: WriterLock,
  gate: StatementGate,
): ProjectStore => {
  const orm = drizzleOf(db);
  return {
    list: () =>
      gate.run(() =>
        orm
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

/** The `orders` projection as a reader port. Rows are read as stored; nothing is folded here. */
export const sqliteProjectionReader = (
  db: Database,
  gate: StatementGate,
): ProjectionReader => {
  const orm = drizzleOf(db);
  return {
    orders: (): Promise<OrderProjection[]> => gate.run(() => loadOrders(orm)),
    plans: (): Promise<PlanProjection[]> => gate.run(() => loadPlans(orm)),
  };
};
