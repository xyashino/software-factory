import { z } from 'zod';
import {
  blobRefSchema,
  commitShaSchema,
  cycleIdSchema,
  jobIdSchema,
  orderIdSchema,
  projectIdSchema,
  stationIdSchema,
} from '../ids';
import { cycleCauseSchema, jobKindSchema } from '../order/events';

/**
 * A path the Worker resolves itself: relative to its worktree, never absolute, never climbing out.
 * Absolute POSIX and Windows forms are refused (PROTOCOL §4, RULES §4.5).
 */
const relativePath = z
  .string()
  .min(1)
  .max(512)
  .refine((path) => !/^([/\\]|[A-Za-z]:)/.test(path), 'path must be relative')
  .refine(
    (path) => !path.split(/[/\\]/).includes('..'),
    'path must not climb out of the worktree',
  );

const timeoutMs = z.number().int().min(1);

const repoSchema = z
  .object({
    url: z.string().min(1).max(512),
    baseBranch: z.string().min(1).max(128),
    branch: z.string().min(1).max(128),
  })
  .strict();

const workspaceSchema = z
  .object({
    dir: relativePath,
    sync: z.array(z.string().min(1).max(512)).max(32),
    setup: z.array(z.string().min(1).max(512)).max(32),
    timeoutMs,
  })
  .strict();

const operatorSchema = z
  .object({
    profile: z.string().min(1).max(64),
    runner: z.string().min(1).max(64),
    model: z.string().min(1).max(128),
    permission: z.enum(['read', 'write']),
    headless: z.boolean(),
    timeoutMs,
  })
  .strict();

const runtimePromptsSchema = z
  .object({
    answer: z.string(),
    nudge: z.string(),
    idleReminder: z.string(),
    silentReminder: z.string(),
    handoverRequest: z.string(),
  })
  .strict();

const stationSchema = z
  .object({
    stationId: stationIdSchema,
    cycleId: cycleIdSchema,
    n: z.number().int().min(1),
    cause: cycleCauseSchema,
    operator: operatorSchema.optional(),
    promptBlob: blobRefSchema.optional(),
    inputs: z
      .array(z.object({ blob: blobRefSchema, path: relativePath }).strict())
      .max(64)
      .optional(),
    outputs: z
      .array(
        z
          .object({
            key: z.string().min(1).max(64),
            path: relativePath,
            required: z.boolean(),
          })
          .strict(),
      )
      .max(64)
      .optional(),
    verdict: z.boolean().optional(),
    runtimePrompts: runtimePromptsSchema.optional(),
    exec: z.array(z.string().min(1).max(512)).max(32).optional(),
    inspectionTimeoutMs: timeoutMs.optional(),
  })
  .strict();

const deliverSchema = z
  .object({
    title: z.string().min(1).max(256),
    bodyBlob: blobRefSchema,
    commitMessage: z.string().min(1).max(4096),
    removeTodo: relativePath,
  })
  .strict();

/** A job a Worker runs: PROTOCOL §4, the shape the claim and the continuation return. */
export const jobSchema = z
  .object({
    jobId: jobIdSchema,
    orderId: orderIdSchema,
    projectId: projectIdSchema,
    epoch: z.number().int().min(1),
    kind: jobKindSchema,
    repo: repoSchema,
    base: z.union([
      commitShaSchema,
      z.object({ branchBase: z.string().min(1).max(128) }).strict(),
    ]),
    workspace: workspaceSchema,
    station: stationSchema.optional(),
    deliver: deliverSchema.optional(),
  })
  .strict();

export type Job = z.infer<typeof jobSchema>;
