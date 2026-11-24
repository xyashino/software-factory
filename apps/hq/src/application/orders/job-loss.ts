import type { JobRow, StorageWriteTx } from '../ports/storage.port';
import {
  insertPlanBranchJob,
  orderTransition,
  updateWorkOrder,
  type Actor,
  type TransitionLog,
} from './order-writes';

const requeueOrder = (
  tx: StorageWriteTx,
  job: JobRow,
  now: number,
  actor: Actor,
  log: TransitionLog,
): void => {
  if (job.orderId === null) return;
  const order = tx.orders.find(job.orderId);
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

const requeuePlanBranch = (
  tx: StorageWriteTx,
  job: JobRow,
  now: number,
): void => {
  if (job.planId === null) return;
  const plan = tx.plans.find(job.planId);
  if (plan === undefined || plan.state !== 'branching') return;
  insertPlanBranchJob(tx, plan, job.repoUrl, now);
};

export const loseJob = (
  tx: StorageWriteTx,
  job: JobRow,
  now: number,
  actor: Actor,
  log: TransitionLog,
): void => {
  tx.jobs.update(job.jobId, { status: 'lost', finishedAt: now });
  requeueOrder(tx, job, now, actor, log);
  requeuePlanBranch(tx, job, now);
};
