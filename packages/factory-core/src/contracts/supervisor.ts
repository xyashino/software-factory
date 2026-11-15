import { z } from 'zod';
import {
  blobRefSchema,
  cellIdSchema,
  orderIdSchema,
  planIdSchema,
  planSlugSchema,
  projectIdSchema,
  stationIdSchema,
  todoIdSchema,
} from '../ids';
import { lineSnapshotSchema } from '../line/snapshot';
import {
  changeTypes,
  prUrl,
  priorities,
  resumeModeSchema,
  storedEventSchema,
} from '../order/events';
import { commandResultSchema } from './cell';

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
    /** The Order Plan this Work order belongs to (CORE §12.1), or null. */
    plan: z.string().nullable(),
    /** The base branch the Work order was created on (CORE §12.5). */
    baseBranch: z.string(),
    dependsOn: z.array(orderIdSchema),
  })
  .passthrough();

export const boardResponseSchema = z
  .object({ orders: z.array(boardRowSchema) })
  .strict();

/** One Order Plan's row on the board (CORE §12.3, STORAGE §4). */
export const planRowSchema = z
  .object({
    planId: planIdSchema,
    projectId: z.string(),
    slug: z.string(),
    branch: z.string(),
    baseBranch: z.string(),
    phase: z.string(),
    holder: z.string(),
    nextKind: z.string(),
    jobKind: z.string().nullable(),
    memberCount: z.number().int(),
    prUrl: z.string().nullable(),
    prState: z.string().nullable(),
    andonReason: z.string().nullable(),
    updatedAt: z.number().int(),
  })
  .strict();

/** One member of a plan, in chain order, with its board status and what blocks it (PROTOCOL §10). */
export const planMemberSchema = z
  .object({
    orderId: orderIdSchema,
    todoId: z.string(),
    after: orderIdSchema.nullable(),
    state: z.string(),
    status: z.string().nullable(),
    baseBranch: z.string().nullable(),
    prUrl: z.string().nullable(),
    blocker: z.string().nullable(),
  })
  .strict();

export const planListResponseSchema = z
  .object({ plans: z.array(planRowSchema) })
  .strict();

export const planDetailRequestSchema = z
  .object({ planId: planIdSchema })
  .strict();

export const planDetailResponseSchema = z
  .object({ plan: planRowSchema, members: z.array(planMemberSchema) })
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

/**
 * The project registry (PROTOCOL §3.1). A branch name is one token: no whitespace, no leading `-`.
 * `repoUrl` is required on add only; a set body that names it is refused (the schema is strict).
 */
const branchName = z
  .string()
  .min(1)
  .max(255)
  .regex(/^\S+$/, 'a branch name has no whitespace')
  .refine(
    (name) => !name.startsWith('-'),
    'a branch name does not start with -',
  );

export const depPolicySchema = z.enum(['delivered', 'merged']);

const maxRunningSchema = z.number().int().positive();

export const projectRecordSchema = z
  .object({
    projectId: projectIdSchema,
    repoUrl: z.string().min(1).max(2048),
    baseBranch: branchName,
    maxRunning: maxRunningSchema,
    depPolicy: depPolicySchema,
  })
  .strict();

export const projectListResponseSchema = z
  .object({ projects: z.array(projectRecordSchema) })
  .strict();

export const projectAddRequestSchema = z
  .object({
    projectId: projectIdSchema,
    repoUrl: z.string().min(1).max(2048),
    baseBranch: branchName.default('main'),
    maxRunning: maxRunningSchema.default(2),
    depPolicy: depPolicySchema.default('delivered'),
  })
  .strict();

/** A patch of at least one field: an empty `set` changes nothing and is refused as invalid. */
export const projectSetRequestSchema = z
  .object({
    projectId: projectIdSchema,
    baseBranch: branchName.optional(),
    maxRunning: maxRunningSchema.optional(),
    depPolicy: depPolicySchema.optional(),
  })
  .strict()
  .refine(
    (request) =>
      request.baseBranch !== undefined ||
      request.maxRunning !== undefined ||
      request.depPolicy !== undefined,
    'set at least one of baseBranch, maxRunning, depPolicy',
  );

export const projectRemoveRequestSchema = z
  .object({ projectId: projectIdSchema })
  .strict();

export const projectResponseSchema = z
  .object({ project: projectRecordSchema })
  .strict();

export const projectRemoveResponseSchema = z
  .object({ projectId: projectIdSchema, removed: z.literal(true) })
  .strict();

/**
 * A Cell ensures its repository's project exists (PROTOCOL §3.1). Only the id and the repo url: an
 * existing project keeps its base branch, max running and dependency policy.
 */
export const cellProjectEnsureRequestSchema = z
  .object({
    projectId: projectIdSchema,
    repoUrl: z.string().min(1).max(2048),
  })
  .strict();

/** `created` is false when the project was already registered; the record is as stored either way. */
export const cellProjectEnsureResponseSchema = z
  .object({ project: projectRecordSchema, created: z.boolean() })
  .strict();

/**
 * A Work order's spec and its pinned Line, as the task API takes them (PROTOCOL §3.3, CORE §4.4). The
 * body is the markdown spec; the server stores it as a blob and never reads a repo definition for it.
 */
const taskSpecFields = {
  todoId: todoIdSchema,
  title: z.string().min(1).max(256),
  type: changeTypes,
  body: z.string().min(1).max(262144),
  line: lineSnapshotSchema,
  priority: priorities,
};

export const createOrderRequestSchema = z
  .object({
    commandId: z.string().min(1).max(128),
    projectId: projectIdSchema,
    ...taskSpecFields,
    dependsOn: z.array(orderIdSchema).max(64).default([]),
    plan: planSlugSchema.optional(),
    baseBranch: z.string().min(1).max(128).optional(),
  })
  .strict();

export const createOrderResponseSchema = commandResultSchema
  .extend({ orderId: orderIdSchema })
  .strict();

/**
 * One member of an Order Plan. Members form a linear chain in the order given: each one depends on the
 * member before it, so a member names no dependencies of its own (CORE §12.1).
 */
const chainMemberSchema = z
  .object({
    todoId: todoIdSchema,
    title: z.string().min(1).max(256),
    type: changeTypes,
    body: z.string().min(1).max(262144),
    line: lineSnapshotSchema,
    priority: priorities,
  })
  .strict();

export const createPlanRequestSchema = z
  .object({
    commandId: z.string().min(1).max(128),
    projectId: projectIdSchema,
    slug: planSlugSchema,
    baseBranch: z.string().min(1).max(128).optional(),
    members: z.array(chainMemberSchema).min(1).max(64),
  })
  .strict()
  .superRefine((plan, ctx) => {
    const seen = new Set<string>();
    plan.members.forEach((member, index) => {
      if (seen.has(member.todoId)) {
        ctx.addIssue({
          code: 'custom',
          message: `todo ${member.todoId} is listed twice`,
          path: ['members', index, 'todoId'],
        });
      }
      seen.add(member.todoId);
    });
  });

export const createPlanResponseSchema = z
  .object({
    planId: planIdSchema,
    orderIds: z.array(orderIdSchema),
    dryRun: z.boolean(),
    events: commandResultSchema.shape.events,
    next: commandResultSchema.shape.next,
  })
  .strict();

/** A Work order's pull request state, reported by the runtime (CORE §5.2, `RecordPrState`). */
export const recordPrStateRequestSchema = z
  .object({
    orderId: orderIdSchema,
    commandId: z.string().min(1).max(128),
    prUrl,
    state: z.enum(['open', 'merged', 'closed']),
  })
  .strict();

/** An Order Plan's pull request state (CORE §12.3, `RecordPlanPrState`). */
export const recordPlanPrStateRequestSchema = z
  .object({
    planId: planIdSchema,
    commandId: z.string().min(1).max(128),
    prUrl,
    state: z.enum(['open', 'merged', 'closed']),
  })
  .strict();

export const recordPlanPrStateResponseSchema = z
  .object({
    dryRun: z.boolean(),
    events: commandResultSchema.shape.events,
    next: commandResultSchema.shape.next,
  })
  .strict();
