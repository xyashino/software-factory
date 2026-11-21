import { z } from 'zod';
import { idParams } from './common';
import { claimedJobDto } from './cells.contract';

const commandSchema = z.object({
  commandId: z.string().trim().min(1),
  epoch: z.number().int(),
});

const startSchema = commandSchema.extend({
  action: z.literal('start'),
  lineSnapshot: z.unknown().optional(),
});

const completeSchema = commandSchema.extend({
  action: z.literal('complete'),
  producedFiles: z.array(z.string().trim().min(1)),
  commitSha: z.string().trim().min(1).optional(),
  output: z.record(z.string(), z.unknown()).optional(),
});

const failSchema = commandSchema.extend({
  action: z.literal('fail'),
  detail: z.string().trim().min(1),
  output: z.record(z.string(), z.unknown()).optional(),
  workspaceFailed: z.boolean().optional(),
});

const blockSchema = commandSchema.extend({
  action: z.literal('block'),
  detail: z.string().trim().min(1),
  handoverFile: z.string().trim().min(1).optional(),
});

const worktreeMissingSchema = commandSchema.extend({
  action: z.literal('worktree_missing'),
  missingStepId: z.string().trim().min(1),
  missingFiles: z.array(z.string().trim().min(1)),
});

const lineUnavailableSchema = commandSchema.extend({
  action: z.literal('line_unavailable'),
  lineName: z.string().trim().min(1),
  detail: z.string().trim().min(1),
});

const startedDto = z.object({
  code: z.literal(200),
  action: z.literal('start'),
  status: z.literal('running'),
});

const completedDto = z.object({
  code: z.literal(200),
  action: z.literal('complete'),
  completed: z.literal(true),
  nextJob: claimedJobDto.nullable(),
});

const failedDto = z.object({
  code: z.literal(200),
  action: z.literal('fail'),
  failed: z.literal(true),
  nextJob: claimedJobDto,
});

const blockedDto = z.object({
  code: z.literal(200),
  action: z.enum(['fail', 'block', 'worktree_missing']),
  blocked: z.literal(true),
});

const resetDto = z.object({
  code: z.literal(200),
  action: z.literal('worktree_missing'),
  resetToScratch: z.literal(true),
  nextJob: claimedJobDto,
});

const lineUnavailableDto = z.object({
  code: z.literal(200),
  action: z.literal('line_unavailable'),
  markedLineUnavailable: z.literal(true),
  nextJob: claimedJobDto.nullable(),
});

export const transitionJobContract = {
  in: {
    params: idParams,
    body: z.discriminatedUnion('action', [
      startSchema,
      completeSchema,
      failSchema,
      blockSchema,
      worktreeMissingSchema,
      lineUnavailableSchema,
    ]),
  },
  out: {
    200: z.union([
      startedDto,
      completedDto,
      failedDto,
      blockedDto,
      resetDto,
      lineUnavailableDto,
    ]),
  },
};
