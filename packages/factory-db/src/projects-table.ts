import type { Database } from 'bun:sqlite';
import { asc } from 'drizzle-orm';
import type { ProjectId } from '@repo/factory-core/ids';
import type {
  ProjectPatch,
  ProjectStore,
  ProjectStoreResult,
} from '@repo/factory-core/ports/projects';
import type { ProjectionReader } from '@repo/factory-core/ports/projection-reader';
import type { OrderProjection } from '@repo/factory-core/order/projection';
import { drizzleOf } from './db';
import { loadOrders } from './orders-table';
import { loadPlans } from './plans-table';
import type { PlanProjection } from '@repo/factory-core/plan/projection';
import { projects } from './schema';
import type { StatementGate } from './sqlite-event-store';
import type { WriterLock } from './writer-lock';

/** The Work order statuses after which a base branch is no longer held (CORE §4.2). */
const TERMINAL_STATUSES = "('delivered', 'merged', 'cancelled')";

interface ProjectRow {
  project_id: string;
  repo_url: string;
  base_branch: string;
  max_running: number;
  dep_policy: 'delivered' | 'merged';
  created_at: number;
}

const refused = (
  reason: 'missing' | 'has_history' | 'base_branch_busy' | 'exists',
): ProjectStoreResult => ({
  ok: false,
  reason,
});

/** The `projects` row of one id, or undefined. */
const rowOf = (db: Database, projectId: string): ProjectRow | undefined =>
  db
    .query<ProjectRow, [string]>('SELECT * FROM projects WHERE project_id = ?')
    .get(projectId) ?? undefined;

/**
 * True when the project has any Work order, event or intake row. Events belong to a project through
 * their order id, which is `<projectId>:<todoId>` (core `orderIdOf`).
 */
const hasHistory = (db: Database, projectId: string): boolean => {
  const eventPrefix = `${projectId}:`;
  return (
    db
      .query<{ history: number }, [string, string, string, string]>(
        `SELECT
           EXISTS (SELECT 1 FROM orders WHERE project_id = ?)
           OR EXISTS (SELECT 1 FROM events WHERE substr(order_id, 1, length(?)) = ?)
           OR EXISTS (SELECT 1 FROM intake WHERE project_id = ?) AS history`,
      )
      .get(projectId, eventPrefix, eventPrefix, projectId)?.history === 1
  );
};

/** True when a Work order of the project is not terminal, so it runs on the base branch now. */
const holdsBaseBranch = (db: Database, projectId: string): boolean =>
  db
    .query<{ found: number }, [string]>(
      `SELECT 1 AS found FROM orders
       WHERE project_id = ? AND status NOT IN ${TERMINAL_STATUSES} LIMIT 1`,
    )
    .get(projectId) !== null;

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
        if (rowOf(db, project.projectId)) return refused('exists');
        db.run(
          `INSERT INTO projects (project_id, repo_url, base_branch, max_running, dep_policy, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            project.projectId,
            project.repoUrl,
            project.baseBranch,
            project.maxRunning,
            project.depPolicy,
            createdAt,
          ],
        );
        return { ok: true };
      }),
    set: (projectId, patch: ProjectPatch) =>
      gate.run((): ProjectStoreResult => {
        writer.assertHeld();
        const current = rowOf(db, projectId);
        if (!current) return refused('missing');
        const changesBase =
          patch.baseBranch !== undefined &&
          patch.baseBranch !== current.base_branch;
        if (changesBase && holdsBaseBranch(db, projectId)) {
          return refused('base_branch_busy');
        }
        db.run(
          'UPDATE projects SET base_branch = ?, max_running = ?, dep_policy = ? WHERE project_id = ?',
          [
            patch.baseBranch ?? current.base_branch,
            patch.maxRunning ?? current.max_running,
            patch.depPolicy ?? current.dep_policy,
            projectId,
          ],
        );
        return { ok: true };
      }),
    remove: (projectId) =>
      gate.run((): ProjectStoreResult => {
        writer.assertHeld();
        if (!rowOf(db, projectId)) return refused('missing');
        if (hasHistory(db, projectId)) return refused('has_history');
        db.run('DELETE FROM projects WHERE project_id = ?', [projectId]);
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
