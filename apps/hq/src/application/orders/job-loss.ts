import type { JobRow, StorageWriteTx } from '../ports/storage.port';
import {
  insertPlanBranchJob,
  orderTransition,
  updateWorkOrder,
  type Actor,
  type TransitionLog,
} from './order-writes';

const requeueOrder = async (
  tx: StorageWriteTx,
  job: JobRow,
  now: number,
  actor: Actor,
  log: TransitionLog,
): Promise<void> => {
  if (job.orderId === null) return;
  const order = await tx.orders.find(job.orderId);
  if (order === undefined || order.activeJobId !== job.jobId) return;
  await updateWorkOrder(
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

const requeuePlanBranch = async (
  tx: StorageWriteTx,
  job: JobRow,
  now: number,
): Promise<void> => {
  if (job.planId === null) return;
  const plan = await tx.plans.find(job.planId);
  if (plan === undefined || plan.state !== 'branching') return;
  await insertPlanBranchJob(tx, plan, job.repoUrl, now);
};

export const loseJob = async (
  tx: StorageWriteTx,
  job: JobRow,
  now: number,
  actor: Actor,
  log: TransitionLog,
): Promise<void> => {
  await tx.jobs.update(job.jobId, { status: 'lost', finishedAt: now });
  await requeueOrder(tx, job, now, actor, log);
  await requeuePlanBranch(tx, job, now);
};
