import type { Database } from 'bun:sqlite';
import { asc } from 'drizzle-orm';
import type { ProjectId } from '@repo/factory-core/ids';
import type { ProjectStore } from '@repo/factory-core/ports/projects';
import type { ProjectionReader } from '@repo/factory-core/ports/projection-reader';
import type { OrderProjection } from '@repo/factory-core/order/projection';
import { drizzleOf } from './db';
import { loadOrders } from './orders-table';
import { projects } from './schema';
import type { StatementGate } from './sqlite-event-store';

/** The `projects` table, read-only here: the Factory registers projects, the runtime reads them. */
export const sqliteProjectStore = (
  db: Database,
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
  };
};
