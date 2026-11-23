import { z } from 'zod';
import {
  idParams,
  slugSchema,
  titleSchema,
} from '@repo/zod-contract-kit/fields';
import { projectIdSchema } from './common';
import {
  ORDER_TYPES,
  PRIORITIES,
  WORK_ORDER_ACTIONS,
  WORK_ORDER_STATES,
} from './enums/orders';

export const workOrderDto = z.object({
  orderId: z.string(),
  projectId: z.string(),
  planId: z.string().nullable(),
  parentOrderId: z.string().nullable(),
  slug: z.string(),
  title: z.string(),
  type: z.enum(ORDER_TYPES),
  description: z.string(),
  lineName: z.string(),
  priority: z.enum(PRIORITIES),
  state: z.enum(WORK_ORDER_STATES),
  baseBranch: z.string(),
  baseCommitSha: z.string().nullable(),
  branch: z.string(),
  headCommitSha: z.string().nullable(),
  staleBase: z.boolean(),
  currentStepIndex: z.number().int(),
  pinnedFactoryId: z.string().nullable(),
  activeCellId: z.string().nullable(),
  activeJobId: z.string().nullable(),
  epoch: z.number().int(),
  unavailableLineFactoryIds: z.array(z.string()),
  version: z.number().int(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});

const stepDto = z.object({
  stepId: z.string(),
  stepIndex: z.number().int(),
  stationId: z.string(),
  kind: z.string(),
  state: z.string(),
});

const jobDto = z.object({
  jobId: z.string(),
  kind: z.string(),
  status: z.string(),
  cellId: z.string().nullable(),
  epoch: z.number().int(),
});

const incidentDto = z.object({
  incidentId: z.string(),
  reason: z.string(),
  status: z.string(),
});

export const createWorkOrderContract = {
  in: {
    body: z.object({
      projectId: projectIdSchema,
      slug: slugSchema,
      title: titleSchema,
      type: z.enum(ORDER_TYPES),
      description: z.string().trim().default(''),
      lineName: slugSchema,
      priority: z.enum(PRIORITIES).default('medium'),
      planSlug: slugSchema.nullish(),
      parentSlug: slugSchema.nullish(),
    }),
  },
  out: {
    201: z.object({ code: z.literal(201), order: workOrderDto }),
  },
};

export const listWorkOrdersContract = {
  in: {
    query: z.object({
      projectId: projectIdSchema,
      planId: z.string().trim().min(1).optional(),
      lineName: slugSchema.optional(),
      state: z.enum(WORK_ORDER_STATES).optional(),
      pinnedFactoryId: z.string().trim().min(1).optional(),
    }),
  },
  out: {
    200: z.object({ code: z.literal(200), items: z.array(workOrderDto) }),
  },
};

export const getWorkOrderContract = {
  in: { params: idParams },
  out: {
    200: z.object({
      code: z.literal(200),
      order: workOrderDto,
      steps: z.array(stepDto),
      jobs: z.array(jobDto),
      incidents: z.array(incidentDto),
    }),
  },
};

export const transitionWorkOrderContract = {
  in: {
    params: idParams,
    body: z.object({ action: z.enum(WORK_ORDER_ACTIONS) }),
  },
  out: {
    200: z.object({ code: z.literal(200), order: workOrderDto }),
  },
};
