import { z } from 'zod';
import {
  idParams,
  slugSchema,
  titleSchema,
} from '@repo/zod-contract-kit/fields';
import { projectIdSchema } from './common';
import { PLAN_ACTIONS, PLAN_STATES } from './enums/orders';
import { workOrderDto } from './work-orders.contract';

export const orderPlanDto = z.object({
  planId: z.string(),
  projectId: z.string(),
  slug: z.string(),
  title: z.string(),
  baseBranch: z.string(),
  branch: z.string(),
  branchCommitSha: z.string().nullable(),
  state: z.enum(PLAN_STATES),
  failureDetail: z.string().nullable(),
  version: z.number().int(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});

export const createOrderPlanContract = {
  in: {
    body: z.object({
      projectId: projectIdSchema,
      slug: slugSchema,
      title: titleSchema,
      baseBranch: z.string().trim().min(1).optional(),
      activate: z.boolean().default(false),
    }),
  },
  out: {
    201: z.object({ code: z.literal(201), plan: orderPlanDto }),
  },
};

export const listOrderPlansContract = {
  in: {
    query: z.object({
      projectId: projectIdSchema,
      state: z.enum(PLAN_STATES).optional(),
    }),
  },
  out: {
    200: z.object({ code: z.literal(200), items: z.array(orderPlanDto) }),
  },
};

export const getOrderPlanContract = {
  in: { params: idParams },
  out: {
    200: z.object({
      code: z.literal(200),
      plan: orderPlanDto,
      workOrders: z.array(workOrderDto),
    }),
  },
};

export const transitionOrderPlanContract = {
  in: {
    params: idParams,
    body: z.object({ action: z.enum(PLAN_ACTIONS) }),
  },
  out: {
    200: z.object({ code: z.literal(200), plan: orderPlanDto }),
  },
};
