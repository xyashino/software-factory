import { z } from 'zod';
import { projectIdSchema, slugSchema } from './common';

const allowedLinesSchema = z
  .array(z.union([z.literal('*'), slugSchema]))
  .min(1);

const runnersSchema = z.array(slugSchema);

const localWorktreesSchema = z.array(
  z.object({
    orderId: z.string().trim().min(1),
    completedStepIds: z.array(z.string().trim().min(1)),
  }),
);

const resumedJobDto = z.object({
  jobId: z.string(),
  orderId: z.string().nullable(),
  stepId: z.string().nullable(),
  epoch: z.number().int(),
  leaseExpiresAt: z.number().int(),
});

export const enrollCellContract = {
  in: {
    body: z.object({
      projectId: projectIdSchema,
      name: slugSchema,
      allowedLines: allowedLinesSchema,
      runners: runnersSchema,
    }),
  },
  out: {
    201: z.object({
      code: z.literal(201),
      cellId: z.string(),
      sessionToken: z.string(),
      expiresAt: z.number().int(),
    }),
  },
};

export const helloCellContract = {
  in: {
    body: z.object({
      projectId: projectIdSchema,
      allowedLines: allowedLinesSchema,
      runners: runnersSchema,
      localWorktrees: localWorktreesSchema.default([]),
    }),
  },
  out: {
    200: z.object({
      code: z.literal(200),
      cellId: z.string(),
      resumedJob: resumedJobDto.optional(),
    }),
  },
};
