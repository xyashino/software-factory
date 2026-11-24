import { getWorkOrderContract } from '@repo/hq-contracts/work-orders.contract';
import { scopedProcedure } from '../../core/procedure';
import { requireOrder } from '../../orders/order-writes';
import { toWorkOrderDto } from '../../orders/order-views';

export const getWorkOrderProcedure = scopedProcedure(['supervisor:read'])(
  getWorkOrderContract,
)(async (input, ctx) => {
  const { order, steps, orderJobs, orderIncidents } = await ctx.storage.read(
    (tx) => {
      const order = requireOrder(tx, input.params.id);
      return {
        order,
        steps: tx.steps.listByOrder(order.orderId),
        orderJobs: tx.jobs.listByOrder(order.orderId),
        orderIncidents: tx.incidents.list({
          projectId: order.projectId,
          orderId: order.orderId,
        }),
      };
    },
  );
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
