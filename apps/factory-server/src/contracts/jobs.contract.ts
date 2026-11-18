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

export const transitionJobContract = {
  in: {
    params: idParams,
    body: z.discriminatedUnion('action', [startSchema, completeSchema]),
  },
  out: {
    200: z.union([startedDto, completedDto]),
  },
};
