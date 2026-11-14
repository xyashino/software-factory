import { z } from 'zod';
import {
  blobRefSchema,
  jobIdSchema,
  orderIdSchema,
  projectIdSchema,
  questionIdSchema,
  workerIdSchema,
} from '../ids';
import { orderCommandSchema } from '../order/commands';
import { orderEventSchema } from '../order/events';
import { jobSchema } from './job';

/** Longest a claim may wait before it answers `none` (PROTOCOL §5.2, long-poll ≤ 25 s). */
export const MAX_CLAIM_WAIT_MS = 25_000;

const signalIdSchema = z.string().min(1).max(64);

/** A Worker announces itself and its capacity; the answer is the runtime config it must follow. */
export const helloRequestSchema = z
  .object({
    workerId: workerIdSchema,
    version: z.string().min(1).max(64),
    projects: z.array(projectIdSchema).max(64),
    runners: z.array(z.string().min(1).max(64)).max(32),
    capabilities: z.array(z.string().min(1).max(64)).max(32),
    slots: z.number().int().min(1).max(64),
  })
  .strict();

export const helloResponseSchema = z
  .object({
    workerId: workerIdSchema,
    config: z
      .object({
        leaseTtlMs: z.number().int().min(1),
        heartbeatMs: z.number().int().min(1),
        reaperMs: z.number().int().min(1),
        selfFenceMs: z.number().int().min(1),
      })
      .strict(),
  })
  .strict();

export const claimRequestSchema = z
  .object({
    workerId: workerIdSchema,
    waitMs: z.number().int().min(0).max(MAX_CLAIM_WAIT_MS),
  })
  .strict();

export const claimResponseSchema = z
  .object({ job: jobSchema.nullable() })
  .strict();

/** A signal the Factory sends during a job (PROTOCOL §7). Kept until acknowledged. */
export const signalSchema = z.discriminatedUnion('kind', [
  z
    .object({
      signalId: signalIdSchema,
      jobId: jobIdSchema,
      kind: z.literal('answer'),
      questionId: questionIdSchema,
      text: z.string(),
    })
    .strict(),
  z
    .object({
      signalId: signalIdSchema,
      jobId: jobIdSchema,
      kind: z.literal('nudge'),
      text: z.string(),
    })
    .strict(),
]);

export type Signal = z.infer<typeof signalSchema>;

export const heartbeatRequestSchema = z
  .object({
    workerId: workerIdSchema,
    jobs: z.array(jobIdSchema).max(64),
    acked: z.array(signalIdSchema).max(256),
  })
  .strict();

export const heartbeatResponseSchema = z
  .object({
    jobs: z.array(
      z
        .object({ jobId: jobIdSchema, status: z.enum(['ok', 'stale']) })
        .strict(),
    ),
    signals: z.array(signalSchema),
  })
  .strict();

/**
 * A command a Worker sends for its job. The actor is the Worker; `epoch` is the epoch it holds.
 * `dryRun` runs every check and appends nothing (PROTOCOL §8.2).
 */
export const submitCommandRequestSchema = z
  .object({
    workerId: workerIdSchema,
    orderId: orderIdSchema,
    commandId: z.string().min(1).max(128),
    epoch: z.number().int().min(1),
    command: orderCommandSchema,
    dryRun: z.boolean().optional(),
  })
  .strict();

/**
 * The result of a command: the events it produced (bare, without the store envelope) and, when it
 * ended the job and the same Work order has a job this Worker can run, that job (PROTOCOL §4).
 */
export const commandResultSchema = z
  .object({
    dryRun: z.boolean(),
    events: z.array(orderEventSchema),
    next: jobSchema.nullable(),
  })
  .strict();

export const blobPutRequestSchema = z
  .object({
    ref: blobRefSchema,
    base64: z.string(),
    mediaType: z.string().min(1).max(128).optional(),
  })
  .strict();

export const blobGetRequestSchema = z.object({ ref: blobRefSchema }).strict();

export const blobGetResponseSchema = z
  .object({ ref: blobRefSchema, base64: z.string() })
  .strict();

export const blobPutResponseSchema = z.object({ ref: blobRefSchema }).strict();

export type CommandResult = z.infer<typeof commandResultSchema>;
export type Hello = z.infer<typeof helloRequestSchema>;
export type HelloResponse = z.infer<typeof helloResponseSchema>;
export type HeartbeatRequest = z.infer<typeof heartbeatRequestSchema>;
export type HeartbeatResponse = z.infer<typeof heartbeatResponseSchema>;
