import { z } from 'zod';
import { errorReplies, idParams, projectIdSchema, slugSchema } from './common';

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
  payload: z.record(z.string(), z.unknown()),
});

const cellDto = z.object({
  cellId: z.string(),
  projectId: z.string(),
  name: z.string(),
  status: z.enum(['online', 'busy', 'draining', 'offline', 'revoked']),
  allowedLines: z.array(z.string()),
  runners: z.array(z.string()),
  activeJobId: z.string().nullable(),
  lastHeartbeatAt: z.number().int().nullable(),
  leaseExpiresAt: z.number().int().nullable(),
});

export const enrollCellContract = {
  in: {
    body: z
      .object({
        projectId: projectIdSchema,
        name: slugSchema,
        allowedLines: allowedLinesSchema,
        runners: runnersSchema,
      })
      .strict(),
  },
  out: {
    201: z.object({
      code: z.literal(201),
      cellId: z.string(),
      sessionToken: z.string(),
      expiresAt: z.number().int(),
    }),
    ...errorReplies,
  },
};

export const helloCellContract = {
  in: {
    body: z
      .object({
        projectId: projectIdSchema,
        allowedLines: allowedLinesSchema,
        runners: runnersSchema,
        localWorktrees: localWorktreesSchema.default([]),
      })
      .strict(),
  },
  out: {
    200: z.object({
      code: z.literal(200),
      cellId: z.string(),
      resumedJob: resumedJobDto.optional(),
    }),
    ...errorReplies,
  },
};

export const claimJobContract = {
  in: {
    body: z
      .object({
        waitMs: z.number().int().min(0).default(0),
      })
      .strict()
      .optional(),
  },
  out: {
    200: z.object({
      code: z.literal(200),
      job: claimedJobDto.nullable(),
    }),
    ...errorReplies,
  },
};

export const heartbeatCellContract = {
  in: {
    body: z
      .object({
        jobId: z.string().trim().min(1),
        epoch: z.number().int(),
      })
      .strict(),
  },
  out: {
    200: z.object({
      code: z.literal(200),
      leaseExpiresAt: z.number().int().nullable(),
      signals: z.array(z.literal('abort')),
    }),
    ...errorReplies,
  },
};

export const listCellsContract = {
  out: {
    200: z.object({ code: z.literal(200), cells: z.array(cellDto) }),
    ...errorReplies,
  },
};

export const revokeCellContract = {
  in: { params: idParams },
  out: {
    200: z.object({ code: z.literal(200) }),
    ...errorReplies,
  },
};
