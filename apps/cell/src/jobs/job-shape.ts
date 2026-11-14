import type { Job } from '@repo/factory-core/contracts/job';
import { isPlanId, type OrderId } from '@repo/factory-core/ids';

/**
 * The workspace of a Work order job. A plan job has none (PROTOCOL §4: plan jobs work on the bare mirror),
 * so reaching this with one is a bug in the dispatch, not a refusal.
 */
export const workspaceOf = (job: Job): NonNullable<Job['workspace']> => {
  if (job.workspace === undefined) {
    throw new Error(`${job.kind} job ${job.jobId} has no workspace`);
  }
  return job.workspace;
};

/** The OrderId of a Work order job. A plan job names a PlanId, so it is refused here. */
export const orderIdOf = (job: Job): OrderId => {
  if (isPlanId(job.orderId)) {
    throw new Error(`${job.kind} job ${job.jobId} names a plan, not an order`);
  }
  return job.orderId as OrderId;
};
