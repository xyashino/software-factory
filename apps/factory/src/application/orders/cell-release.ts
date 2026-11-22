import { eq } from 'drizzle-orm';
import type { DbTx } from '../../db/client';
import type { cells } from '../../db/schema/cells';
import { jobs } from '../../db/schema/jobs';
import { workOrders } from '../../db/schema/orders';
import type { CellId } from '../../domain/common/brand';
import { loseJob } from './job-loss';
import {
  updateWorkOrder,
  type Actor,
  type TransitionLog,
} from './order-writes';

const ACTIVE_JOB_STATUSES = ['claimed', 'running'] as const;

type CellRow = typeof cells.$inferSelect;

export const unpinOrders = (tx: DbTx, cellId: CellId, now: number): void => {
  const pinned = tx
    .select()
    .from(workOrders)
    .where(eq(workOrders.pinnedCellId, cellId))
    .all();
  for (const row of pinned)
    updateWorkOrder(tx, row, { pinnedCellId: null }, now);
};

export const loseActiveJob = (
  tx: DbTx,
  cell: CellRow,
  now: number,
  actor: Actor,
  log: TransitionLog,
): void => {
  if (cell.activeJobId === null) return;
  const job = tx
    .select()
    .from(jobs)
    .where(eq(jobs.jobId, cell.activeJobId))
    .get();
  if (job === undefined || !ACTIVE_JOB_STATUSES.some((s) => s === job.status))
    return;
  loseJob(tx, job, now, actor, log);
};
