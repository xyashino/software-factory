import { and, eq, inArray } from 'drizzle-orm';
import type { DbTx } from '../../db/client';
import { jobs } from '../../db/schema/jobs';
import { workOrders } from '../../db/schema/orders';
import type { CellId, FactoryId } from '../../domain/common/brand';
import { loseJob } from './job-loss';
import {
  updateWorkOrder,
  type Actor,
  type TransitionLog,
} from './order-writes';

const ACTIVE_JOB_STATUSES = ['claimed', 'running'] as const;

export const unpinOrders = (
  tx: DbTx,
  factoryId: FactoryId,
  now: number,
): void => {
  const pinned = tx
    .select()
    .from(workOrders)
    .where(eq(workOrders.pinnedFactoryId, factoryId))
    .all();
  for (const row of pinned)
    updateWorkOrder(tx, row, { pinnedFactoryId: null }, now);
};

export const loseFactoryJobs = (
  tx: DbTx,
  factoryId: FactoryId,
  now: number,
  actor: Actor,
  log: TransitionLog,
): void => {
  const active = tx
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.claimedByFactoryId, factoryId),
        inArray(jobs.status, ACTIVE_JOB_STATUSES),
      ),
    )
    .all();
  for (const job of active) loseJob(tx, job, now, actor, log);
};

export const loseCellJob = (
  tx: DbTx,
  cellId: CellId,
  factoryId: FactoryId,
  now: number,
  actor: Actor,
  log: TransitionLog,
): void => {
  const job = tx
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.claimedByCellId, cellId),
        eq(jobs.claimedByFactoryId, factoryId),
        inArray(jobs.status, ACTIVE_JOB_STATUSES),
      ),
    )
    .get();
  if (job !== undefined) loseJob(tx, job, now, actor, log);
};
