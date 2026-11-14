import type { Database } from 'bun:sqlite';
import type { ProjectId } from '@repo/factory-core/ids';
import type { ProjectStore } from '@repo/factory-core/ports/projects';
import type { ProjectionReader } from '@repo/factory-core/ports/projection-reader';
import type { OrderProjection } from '@repo/factory-core/order/projection';
import { loadOrders } from './orders-table';
import type { StatementGate } from './sqlite-event-store';

interface ProjectRow {
  project_id: string;
  repo_url: string;
  base_branch: string;
  max_running: number;
  dep_policy: 'delivered' | 'merged';
}

/** The `projects` table, read-only here: the Factory registers projects, the runtime reads them. */
export const sqliteProjectStore = (
  db: Database,
  gate: StatementGate,
): ProjectStore => ({
  list: () =>
    gate.run(() =>
      db
        .query<ProjectRow, []>(
          'SELECT project_id, repo_url, base_branch, max_running, dep_policy FROM projects ORDER BY project_id',
        )
        .all()
        .map((row) => ({
          projectId: row.project_id as ProjectId,
          repoUrl: row.repo_url,
          baseBranch: row.base_branch,
          maxRunning: row.max_running,
          depPolicy: row.dep_policy,
        })),
    ),
});

/** The `orders` projection as a reader port. Rows are read as stored; nothing is folded here. */
export const sqliteProjectionReader = (
  db: Database,
  gate: StatementGate,
): ProjectionReader => ({
  orders: (): Promise<OrderProjection[]> => gate.run(() => loadOrders(db)),
});
