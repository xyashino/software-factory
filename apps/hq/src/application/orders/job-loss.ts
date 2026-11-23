import { eq } from 'drizzle-orm';
import type { DbTx } from '../../db/client';
import { jobs } from '../../db/schema/jobs';
import { workOrders } from '../../db/schema/orders';
import { orderPlans } from '../../db/schema/plans';
import {
  insertPlanBranchJob,
  orderTransition,
  updateWorkOrder,
  type Actor,
  type TransitionLog,
} from './order-writes';

type JobRow = typeof jobs.$inferSelect;
type WorkOrderRow = typeof workOrders.$inferSelect;

const requeueOrder = (
  tx: DbTx,
  job: JobRow,
  now: number,
  actor: Actor,
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
      actor,
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

export const loseJob = (
  tx: DbTx,
  job: JobRow,
  now: number,
  actor: Actor,
  log: TransitionLog,
): void => {
  tx.update(jobs)
    .set({ status: 'lost', finishedAt: now })
    .where(eq(jobs.jobId, job.jobId))
    .run();
  requeueOrder(tx, job, now, actor, log);
  requeuePlanBranch(tx, job, now);
};
