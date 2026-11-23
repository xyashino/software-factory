import { z } from 'zod';
import { slugSchema } from '@repo/zod-contract-kit/fields';
import { projectIdSchema } from './common';

const allowedLinesSchema = z
  .array(z.union([z.literal('*'), slugSchema]))
  .min(1);

const runnersSchema = z.array(slugSchema);

export const stepJobPayloadDto = z.object({
  stepIndex: z.number().int(),
  lineName: z.string(),
  task: z.object({
    slug: z.string(),
    title: z.string(),
    type: z.string(),
    description: z.string(),
  }),
});

export const claimedJobDto = z.object({
  jobId: z.string(),
  kind: z.string(),
  orderId: z.string().nullable(),
  planId: z.string().nullable(),
  stepId: z.string().nullable(),
  workspaceMode: z.enum(['fresh', 'reuse']),
  epoch: z.number().int(),
  leaseExpiresAt: z.number().int(),
  repoUrl: z.string(),
  baseBranch: z.string(),
  baseCommitSha: z.string().nullable(),
  targetBranch: z.string(),
  expectedPriorSteps: z.array(
    z.object({
      stepId: z.string(),
      stationId: z.string(),
      stepIndex: z.number().int(),
      requiredFiles: z.array(z.string()),
    }),
  ),
  incidentId: z.string().nullable().optional(),
  payload: z.record(z.string(), z.unknown()),
});

export const claimJobContract = {
  in: {
    body: z.object({
      waitMs: z.number().int().min(0).default(0),
      projectId: projectIdSchema,
      allowedLines: allowedLinesSchema,
      runners: runnersSchema,
    }),
  },
  out: {
    200: z.object({
      code: z.literal(200),
      job: claimedJobDto.nullable(),
    }),
  },
};

export const heartbeatCellContract = {
  in: {
    body: z.object({
      jobId: z.string().trim().min(1),
      epoch: z.number().int(),
    }),
  },
  out: {
    200: z.object({
      code: z.literal(200),
      leaseExpiresAt: z.number().int().nullable(),
      signals: z.array(z.enum(['abort'])),
    }),
  },
};
