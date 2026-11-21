import { z } from 'zod';
import { PLAN_STATES, errorReplies, projectIdSchema } from './common';

const orderPlanDto = z.object({
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

export const listOrderPlansContract = {
  in: {
    query: z.object({
      projectId: projectIdSchema,
      state: z.enum(PLAN_STATES).optional(),
    }),
  },
  out: {
    200: z.object({ code: z.literal(200), items: z.array(orderPlanDto) }),
    ...errorReplies,
  },
};
