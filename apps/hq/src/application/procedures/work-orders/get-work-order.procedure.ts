import { asc, eq } from 'drizzle-orm';
import { getWorkOrderContract } from '@repo/hq-contracts/work-orders.contract';
import { incidents } from '../../../db/schema/incidents';
import { jobs } from '../../../db/schema/jobs';
import { orderSteps } from '../../../db/schema/orders';
import { scopedProcedure } from '../../core/procedure';
import { requireOrder } from '../../orders/order-writes';
import { toWorkOrderDto } from '../../orders/order-views';

export const getWorkOrderProcedure = scopedProcedure(['supervisor:read'])(
  getWorkOrderContract,
)((input, ctx) => {
  const order = requireOrder(ctx.db, input.params.id);
  const steps = ctx.db
    .select()
    .from(orderSteps)
    .where(eq(orderSteps.orderId, order.orderId))
    .orderBy(asc(orderSteps.stepIndex))
    .all();
  const orderJobs = ctx.db
    .select()
    .from(jobs)
    .where(eq(jobs.orderId, order.orderId))
    .all();
  const orderIncidents = ctx.db
    .select()
    .from(incidents)
    .where(eq(incidents.orderId, order.orderId))
    .all();
  return {
    code: 200 as const,
    order: toWorkOrderDto(order),
    steps: steps.map((step) => ({
      stepId: step.stepId,
      stepIndex: step.stepIndex,
      stationId: step.stationId,
      kind: step.kind,
      state: step.state,
    })),
    jobs: orderJobs.map((job) => ({
      jobId: job.jobId,
      kind: job.kind,
      status: job.status,
      cellId: job.claimedByCellId,
      epoch: job.epoch,
    })),
    incidents: orderIncidents.map((incident) => ({
      incidentId: incident.incidentId,
      reason: incident.reason,
      status: incident.status,
    })),
  };
});
