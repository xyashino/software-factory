import { eq, sql } from 'drizzle-orm';
import { cells } from '../../../db/schema/cells';
import { factories } from '../../../db/schema/factories';
import { getHealthContract } from '@repo/cell-contracts/health.contract';
import { RUNTIME_STATUSES } from '@repo/cell-contracts/enums/cells';
import type { RuntimeStatus } from '../../../domain/cells/cell-slot';
import { publicProcedure } from '../../core/procedure';

type StatusCount = { runtimeStatus: RuntimeStatus; n: number };

const countsByStatus = (rows: StatusCount[]): Record<RuntimeStatus, number> => {
  const counts: Record<RuntimeStatus, number> = {
    starting: 0,
    running: 0,
    stopping: 0,
    stopped: 0,
    failed: 0,
  };
  for (const row of rows) counts[row.runtimeStatus] += row.n;
  return counts;
};

export const getHealthProcedure = publicProcedure(getHealthContract)((
  _input,
  ctx,
) => {
  const factory = ctx.db
    .select()
    .from(factories)
    .where(eq(factories.isDefault, true))
    .get();
  const rows = ctx.db
    .select({
      runtimeStatus: cells.runtimeStatus,
      n: sql<number>`count(*)`,
    })
    .from(cells)
    .groupBy(cells.runtimeStatus)
    .all();
  const byRuntimeStatus = countsByStatus(rows);
  return {
    code: 200 as const,
    pid: process.pid,
    defaultFactory: factory
      ? { factoryId: factory.factoryId, url: factory.url }
      : null,
    cells: {
      total: RUNTIME_STATUSES.reduce(
        (sum, status) => sum + byRuntimeStatus[status],
        0,
      ),
      byRuntimeStatus,
    },
  };
});
