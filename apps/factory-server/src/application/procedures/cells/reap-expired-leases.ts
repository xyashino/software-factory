import { and, eq, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import type { DbTx } from '../../../db/client';
import { cells } from '../../../db/schema/cells';
import { jobs } from '../../../db/schema/jobs';
import { workOrders } from '../../../db/schema/orders';
import { orderPlans } from '../../../db/schema/plans';
import { LEASE_TTL_MS } from '../../../config';
import {
  insertPlanBranchJob,
  orderTransition,
  updateWorkOrder,
  type Actor,
  type TransitionLog,
} from '../../orders/order-writes';

const REAPER_ACTOR: Actor = { kind: 'system', id: null };
const EXPIRABLE_JOB_STATUSES = ['claimed', 'running'] as const;
const SILENT_CELL_STATUSES = ['online', 'busy', 'draining'] as const;

type JobRow = typeof jobs.$inferSelect;
type WorkOrderRow = typeof workOrders.$inferSelect;

const requeueOrder = (
  tx: DbTx,
  job: JobRow,
  now: number,
  log: TransitionLog,
): void => {
  if (job.orderId === null) return;
  const order: WorkOrderRow | undefined = tx
    .select()
    .from(workOrders)
    .where(eq(workOrders.orderId, job.orderId))
    .get();
  if (order === undefined || order.activeJobId !== job.jobId) return;
  updateWorkOrder(
    tx,
    order,
    {
      state: 'queued',
      activeJobId: null,
      activeCellId: null,
      epoch: order.epoch + 1,
    },
    now,
  );
  log.push(
    orderTransition({
      projectId: order.projectId,
      entityType: 'work_order',
      entityId: order.orderId,
      fromState: order.state,
      toState: 'queued',
      actor: REAPER_ACTOR,
      at: now,
    }),
  );
};

const requeuePlanBranch = (tx: DbTx, job: JobRow, now: number): void => {
  if (job.planId === null) return;
  const plan = tx
    .select()
    .from(orderPlans)
    .where(eq(orderPlans.planId, job.planId))
    .get();
  if (plan === undefined || plan.state !== 'branching') return;
  insertPlanBranchJob(tx, plan, job.repoUrl, now);
};

const releaseCell = (tx: DbTx, job: JobRow): void => {
  if (job.cellId === null) return;
  const cell = tx
    .select()
    .from(cells)
    .where(eq(cells.cellId, job.cellId))
    .get();
  if (cell === undefined || cell.activeJobId !== job.jobId) return;
  tx.update(cells)
    .set({
      activeJobId: null,
      status: cell.status === 'busy' ? 'online' : cell.status,
    })
    .where(eq(cells.cellId, cell.cellId))
    .run();
};

const markSilentCellsOffline = (tx: DbTx, now: number): void => {
  tx.update(cells)
    .set({ status: 'offline' })
    .where(
      and(
        isNotNull(cells.lastHeartbeatAt),
        sql`${cells.lastHeartbeatAt} + ${LEASE_TTL_MS} <= ${now}`,
        inArray(cells.status, SILENT_CELL_STATUSES),
      ),
    )
    .run();
};

export const reapExpiredLeases = (
  tx: DbTx,
  now: number,
  log: TransitionLog,
): void => {
  const expired = tx
    .select()
    .from(jobs)
    .where(
      and(
        inArray(jobs.status, EXPIRABLE_JOB_STATUSES),
        lte(jobs.leaseExpiresAt, now),
      ),
    )
    .all();
  for (const job of expired) {
    tx.update(jobs)
      .set({ status: 'lost', finishedAt: now })
      .where(eq(jobs.jobId, job.jobId))
      .run();
    requeueOrder(tx, job, now, log);
    requeuePlanBranch(tx, job, now);
    releaseCell(tx, job);
  }
  markSilentCellsOffline(tx, now);
};
