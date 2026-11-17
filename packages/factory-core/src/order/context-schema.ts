import { z } from 'zod';
import { blobRefSchema, cycleIdSchema, stationIdSchema } from '../ids';
import { inspectionResultSchema } from './events';

const relativePathText = z.string().min(1).max(512);
const keyText = z.string().min(1).max(64);

const cycleInputSchema = z.union([
  z
    .object({
      kind: z.literal('artifact'),
      stationId: stationIdSchema,
      key: keyText,
      cycleId: cycleIdSchema,
      blob: blobRefSchema,
      materialiseAs: relativePathText,
    })
    .strict(),
  z
    .object({
      kind: z.literal('inspection'),
      stationId: stationIdSchema,
      cycleId: cycleIdSchema,
      commands: z.array(z.string().min(1).max(512)).max(32),
    })
    .strict(),
  z
    .object({
      kind: z.literal('order'),
      field: z.enum(['title', 'branch']),
      value: z.string().max(512),
    })
    .strict(),
  z
    .object({
      kind: z.literal('order'),
      field: z.literal('body'),
      blob: blobRefSchema,
      materialiseAs: relativePathText,
    })
    .strict(),
]);

const cycleFeedbackSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('verdict'),
      fromCycle: cycleIdSchema,
      blob: blobRefSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('inspection'),
      fromCycle: cycleIdSchema,
      results: z.array(inspectionResultSchema).max(64),
      logBlobs: z.array(blobRefSchema).max(64),
    })
    .strict(),
]);

/** The CycleContext a prompt is built from. */
export const cycleContextSchema = z
  .object({
    inputs: z.array(cycleInputSchema).max(256),
    notes: z
      .array(
        z
          .object({ fromStation: stationIdSchema, text: z.string().max(65536) })
          .strict(),
      )
      .max(256),
    feedback: cycleFeedbackSchema.optional(),
    resume: z
      .object({
        fromCycle: cycleIdSchema.optional(),
        handoverBlob: blobRefSchema.optional(),
        noteBlob: blobRefSchema.optional(),
      })
      .strict()
      .optional(),
    handover: z
      .object({ fromCycle: cycleIdSchema, handoverBlob: blobRefSchema })
      .strict()
      .optional(),
    restart: z
      .object({ of: cycleIdSchema, reason: z.string().max(4096) })
      .strict()
      .optional(),
    nudges: z.array(z.string().max(4096)).max(256),
    priorQuestions: z
      .array(
        z
          .object({
            question: z.string().max(4096),
            answer: z.string().max(4096).optional(),
          })
          .strict(),
      )
      .max(256),
    outputs: z
      .array(z.object({ key: keyText, path: relativePathText }).strict())
      .max(64),
  })
  .strict();

export type CycleContextWire = z.infer<typeof cycleContextSchema>;
