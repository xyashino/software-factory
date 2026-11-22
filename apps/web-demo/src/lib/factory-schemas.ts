import { z } from 'zod';
import { listFactoriesContract } from '@repo/factory-contracts/factories.contract';
import { listIncidentsContract } from '@repo/factory-contracts/incidents.contract';
import {
  getWorkOrderContract,
  workOrderDto,
} from '@repo/factory-contracts/work-orders.contract';

// The pages read only these fields; the factory wire carries more.
const orderSummaryDto = workOrderDto.pick({
  orderId: true,
  projectId: true,
  slug: true,
  title: true,
  type: true,
  lineName: true,
  priority: true,
  state: true,
  branch: true,
  staleBase: true,
  currentStepIndex: true,
  pinnedFactoryId: true,
  activeCellId: true,
  activeJobId: true,
  version: true,
  updatedAt: true,
});

const jobSummaryDto = getWorkOrderContract.out[200].shape.jobs.element.pick({
  jobId: true,
  kind: true,
  status: true,
  cellId: true,
});

const incidentSummaryDto =
  listIncidentsContract.out[200].shape.items.element.pick({
    incidentId: true,
    projectId: true,
    orderId: true,
    failedStepId: true,
    reason: true,
    detail: true,
    status: true,
    triageOwner: true,
    createdAt: true,
    resolvedAt: true,
  });

export const factoriesReply = listFactoriesContract.out[200];

export const workOrdersReply = z.object({
  code: z.literal(200),
  items: z.array(orderSummaryDto),
});

export const workOrderDetailReply = z.object({
  code: z.literal(200),
  order: orderSummaryDto,
  steps: getWorkOrderContract.out[200].shape.steps,
  jobs: z.array(jobSummaryDto),
  incidents: getWorkOrderContract.out[200].shape.incidents,
});

export const incidentsReply = z.object({
  code: z.literal(200),
  items: z.array(incidentSummaryDto),
});

export const transitionReply = z.object({
  code: z.literal(200),
  order: orderSummaryDto,
});
