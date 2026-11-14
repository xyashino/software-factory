import { z } from 'zod';
import {
  blobRefSchema,
  orderIdSchema,
  stationIdSchema,
  workerIdSchema,
} from '../ids';
import {
  priorities,
  resumeModeSchema,
  storedEventSchema,
} from '../order/events';

/** One row of the board: the `orders` projection as the Supervisor reads it. */
export const boardRowSchema = z
  .object({
    orderId: orderIdSchema,
    projectId: z.string(),
    todoId: z.string(),
    title: z.string(),
    line: z.string(),
    priority: priorities,
    status: z.string(),
    holder: z.string(),
    nextKind: z.string(),
    jobKind: z.string().nullable(),
    runner: z.string().nullable(),
    stationId: z.string().nullable(),
    stationIndex: z.number().int().nullable(),
    progressed: z.boolean(),
    resumed: z.boolean(),
    lastSeq: z.number().int(),
    andonReason: z.string().nullable(),
    prUrl: z.string().nullable(),
    prState: z.string().nullable(),
    updatedAt: z.number().int(),
  })
  .passthrough();

export const boardResponseSchema = z
  .object({ orders: z.array(boardRowSchema) })
  .strict();

export const orderDetailRequestSchema = z
  .object({ orderId: orderIdSchema })
  .strict();

/** A Work order's board row and its full Traveler. */
export const orderDetailResponseSchema = z
  .object({
    order: boardRowSchema,
    events: z.array(storedEventSchema),
  })
  .strict();

/** A Supervisor command. The `commandId` is a ULID per CLI invocation (PROTOCOL §6). */
const supervisorBase = z.object({
  orderId: orderIdSchema,
  commandId: z.string().min(1).max(128),
});

export const answerRequestSchema = supervisorBase
  .extend({
    questionId: z.string().min(1).max(64),
    text: z.string().min(1).max(4096),
  })
  .strict();

export const nudgeRequestSchema = supervisorBase
  .extend({ text: z.string().min(1).max(4096) })
  .strict();

export const cancelRequestSchema = supervisorBase
  .extend({ reason: z.string().min(1).max(4096) })
  .strict();

export const reprioritiseRequestSchema = supervisorBase
  .extend({ priority: priorities })
  .strict();

export const resumeRequestSchema = supervisorBase
  .extend({
    mode: resumeModeSchema,
    noteBlob: blobRefSchema.optional(),
    grantRetries: z.number().int().min(0).max(10).optional(),
  })
  .strict();

export const reopenRequestSchema = supervisorBase
  .extend({ stationId: stationIdSchema, noteBlob: blobRefSchema.optional() })
  .strict();

export const workersListResponseSchema = z
  .object({
    workers: z.array(
      z
        .object({
          workerId: workerIdSchema,
          name: z.string(),
          lastSeenAt: z.number().int().nullable(),
          revokedAt: z.number().int().nullable(),
        })
        .strict(),
    ),
  })
  .strict();

export const workerRevokeRequestSchema = z
  .object({ workerId: workerIdSchema })
  .strict();

export const workerRevokeResponseSchema = z
  .object({ workerId: workerIdSchema, revoked: z.literal(true) })
  .strict();

export const emptyRequestSchema = z.object({}).strict();
