import { z } from 'zod';
import {
  blobRefSchema,
  cellIdSchema,
  commitShaSchema,
  orderIdSchema,
  projectIdSchema,
  stationIdSchema,
  todoIdSchema,
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

export const cellsListResponseSchema = z
  .object({
    cells: z.array(
      z
        .object({
          cellId: cellIdSchema,
          name: z.string(),
          lastSeenAt: z.number().int().nullable(),
          revokedAt: z.number().int().nullable(),
        })
        .strict(),
    ),
  })
  .strict();

export const cellRevokeRequestSchema = z
  .object({ cellId: cellIdSchema })
  .strict();

export const cellRevokeResponseSchema = z
  .object({ cellId: cellIdSchema, revoked: z.literal(true) })
  .strict();

export const emptyRequestSchema = z.object({}).strict();

/** The longest a `supervisorEvents` long-poll may hold the request open (PROTOCOL §3.1). */
export const MAX_STREAM_WAIT_MS = 25_000;

/**
 * The event feed (PROTOCOL §3.1, `/v1/stream`): every stored event after `afterGlobalSeq`, oldest
 * first. Held open up to `waitMs` when nothing newer exists, so `status --watch` and `log -f` follow
 * the server without polling tight loops.
 */
export const streamEventsRequestSchema = z
  .object({
    afterGlobalSeq: z.number().int().min(0),
    waitMs: z.number().int().min(0).max(MAX_STREAM_WAIT_MS).optional(),
  })
  .strict();

export const streamEventsResponseSchema = z
  .object({
    events: z.array(storedEventSchema),
    nextSeq: z.number().int().min(0),
  })
  .strict();

/**
 * Runs intake now (PROTOCOL §3.1, `/v1/supervisor/intake/sync`) for one project or every
 * registered project. Intake is idempotent, so the answer does not depend on `commandId`.
 */
export const intakeSyncRequestSchema = z
  .object({
    commandId: z.string().min(1).max(128).optional(),
    projectId: projectIdSchema.optional(),
  })
  .strict();

/** What one intake pass did to one project's todos (STORAGE §4, PROTOCOL §3.1). */
export const intakeProjectReportSchema = z
  .object({
    projectId: projectIdSchema,
    commit: commitShaSchema,
    created: z.array(todoIdSchema),
    updated: z.array(todoIdSchema),
    cancelled: z.array(todoIdSchema),
    specDrift: z.array(todoIdSchema),
    diagnostics: z.array(
      z
        .object({
          todoId: z.string(),
          kind: z.string(),
          message: z.string(),
        })
        .strict(),
    ),
  })
  .strict();

export const intakeSyncResponseSchema = z
  .object({
    created: z.number().int().min(0),
    projects: z.array(intakeProjectReportSchema),
  })
  .strict();

export const joinTokenCreateRequestSchema = z
  .object({
    commandId: z.string().min(1).max(128),
    name: z.string().min(1).max(128),
    ttlSeconds: z
      .number()
      .int()
      .positive()
      .max(365 * 24 * 60 * 60)
      .optional(),
  })
  .strict();

/** The plain token appears only in this answer (PROTOCOL §1). */
export const joinTokenCreateResponseSchema = z
  .object({
    joinTokenId: z.string().min(1),
    name: z.string(),
    token: z.string().min(1),
    expiresAt: z.number().int().nullable(),
  })
  .strict();

export const joinTokenListResponseSchema = z
  .object({
    tokens: z.array(
      z
        .object({
          joinTokenId: z.string().min(1),
          name: z.string(),
          createdAt: z.number().int(),
          expiresAt: z.number().int().nullable(),
          revokedAt: z.number().int().nullable(),
        })
        .strict(),
    ),
  })
  .strict();

export const joinTokenRevokeRequestSchema = z
  .object({ joinTokenId: z.string().min(1).max(64) })
  .strict();

export const joinTokenRevokeResponseSchema = z
  .object({ joinTokenId: z.string().min(1), revoked: z.literal(true) })
  .strict();

/** The export archive (STORAGE §7.3), base64 so it crosses the JSON socket. */
export const adminExportResponseSchema = z
  .object({ base64: z.string(), bytes: z.number().int().min(0) })
  .strict();

/** Admin operations (PROTOCOL §3.1, STORAGE §7). `file` is an absolute path on the server's host. */
const absoluteFile = z
  .string()
  .min(1)
  .max(4096)
  .refine((path) => path.startsWith('/'), 'the file must be an absolute path');

export const adminFileRequestSchema = z.object({ file: absoluteFile }).strict();

const archiveCountsSchema = z
  .object({
    globalSeq: z.number().int().min(0),
    projects: z.number().int().min(0),
    events: z.number().int().min(0),
    blobs: z.number().int().min(0),
  })
  .strict();

export const adminArchiveResponseSchema = z
  .object({ file: absoluteFile, counts: archiveCountsSchema })
  .strict();

export const adminRebuildResponseSchema = z
  .object({ rows: z.number().int().min(0) })
  .strict();
