import { z } from 'zod';
import {
  blobRefSchema,
  jobIdSchema,
  orderIdSchema,
  projectIdSchema,
  questionIdSchema,
  cellIdSchema,
} from '../ids';
import { orderCommandSchema } from '../order/commands';
import { orderEventSchema } from '../order/events';
import { jobSchema } from './job';

/** Longest a claim may wait before it answers `none` (PROTOCOL §5.2, long-poll ≤ 25 s). */
export const MAX_CLAIM_WAIT_MS = 25_000;

const signalIdSchema = z.string().min(1).max(64);

/** A Cell announces itself and its capacity; the answer is the runtime config it must follow. */
export const helloRequestSchema = z
  .object({
    cellId: cellIdSchema,
    version: z.string().min(1).max(64),
    projects: z.array(projectIdSchema).max(64),
    runners: z.array(z.string().min(1).max(64)).max(32),
    capabilities: z.array(z.string().min(1).max(64)).max(32),
    slots: z.number().int().min(1).max(64),
  })
  .strict();

export const helloResponseSchema = z
  .object({
    cellId: cellIdSchema,
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
    cellId: cellIdSchema,
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
    cellId: cellIdSchema,
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
 * A command a Cell sends for its job. The actor is the Cell; `epoch` is the epoch it holds.
 * `dryRun` runs every check and appends nothing (PROTOCOL §8.2).
 */
export const submitCommandRequestSchema = z
  .object({
    cellId: cellIdSchema,
    orderId: orderIdSchema,
    commandId: z.string().min(1).max(128),
    epoch: z.number().int().min(1),
    command: orderCommandSchema,
    dryRun: z.boolean().optional(),
    /**
     * The job the command is for. The remote route carries it in the path (PROTOCOL §3.2), so a remote
     * client needs it here; the socket and the runtime ignore it, since the order and epoch fence the command.
     */
    jobId: jobIdSchema.optional(),
  })
  .strict();

/**
 * The result of a command: the events it produced (bare, without the store envelope) and, when it
 * ended the job and the same Work order has a job this Cell can run, that job (PROTOCOL §4).
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

/**
 * `POST /v1/cell/join` (PROTOCOL §3.2): the join token enrolls a Cell and gets it a credential. The
 * credential is returned once; the runtime keeps its hash. Remote only: the socket has no join.
 */
export const joinRequestSchema = z
  .object({
    joinToken: z.string().min(16).max(256),
    name: z.string().min(1).max(128),
  })
  .strict();

export const joinResponseSchema = z
  .object({
    cellId: cellIdSchema,
    credential: z.string().min(32).max(256),
  })
  .strict();

export type JoinRequest = z.infer<typeof joinRequestSchema>;
export type JoinResponse = z.infer<typeof joinResponseSchema>;

export type CommandResult = z.infer<typeof commandResultSchema>;
export type Hello = z.infer<typeof helloRequestSchema>;
export type HelloResponse = z.infer<typeof helloResponseSchema>;
export type HeartbeatRequest = z.infer<typeof heartbeatRequestSchema>;
export type HeartbeatResponse = z.infer<typeof heartbeatResponseSchema>;
