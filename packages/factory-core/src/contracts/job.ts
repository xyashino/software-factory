import { z } from 'zod';
import {
  blobRefSchema,
  commitShaSchema,
  cycleIdSchema,
  isPlanId,
  jobIdSchema,
  orderIdSchema,
  planIdSchema,
  planSlugSchema,
  projectIdSchema,
  stationIdSchema,
} from '../ids';
import {
  cycleCauseSchema,
  jobKindSchema,
  workspaceStageSchema,
} from '../order/events';
import { cycleContextSchema } from '../order/context-schema';
import { planJobKindSchema } from '../plan/events';

/**
 * A path the Cell resolves itself: relative to its worktree, never absolute, never climbing out.
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

/**
 * What the Cell renders the Operator prompt from (PROTOCOL §4, §9): the task id, the order spec body, the Cycle
 * context and the retry budget. The prompt text and the Operator profile are the Cell's, read from `.factory/`.
 */
const promptInputsSchema = z
  .object({
    taskId: z.string().min(1).max(128),
    todoBodyBlob: blobRefSchema,
    context: cycleContextSchema,
    budget: z
      .object({
        retry: z.number().int().min(0),
        max: z.number().int().min(0),
      })
      .strict(),
  })
  .strict();

const stationSchema = z
  .object({
    stationId: stationIdSchema,
    cycleId: cycleIdSchema,
    n: z.number().int().min(1),
    cause: cycleCauseSchema,
    operator: operatorSchema.optional(),
    prompt: promptInputsSchema.optional(),
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

/**
 * The placeholder a delivery's PR body keeps for the Cell (v1 PR format): only the Cell sees which
 * `decisions/` entries the delivery commit adds, so it replaces this with `adrSectionOf`.
 */
export const PR_ADR_TOKEN = '{{adrSection}}';

/** The PR body's ADR section for the `decisions/` entries a delivery commit adds. */
export const adrSectionOf = (addedDecisions: readonly string[]): string =>
  addedDecisions.length === 0
    ? '_No decisions/ entry recorded for this change._'
    : addedDecisions.map((path) => `- Path: \`${path}\``).join('\n');

/** One line of a PR body's verification list: an Inspection's commands, or an Operator station and its profile. */
const verificationSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('inspection'),
      stationId: stationIdSchema,
      commands: z.array(z.string().min(1).max(512)).max(32),
    })
    .strict(),
  z
    .object({
      kind: z.literal('operator'),
      stationId: stationIdSchema,
      profile: z.string().min(1).max(64),
    })
    .strict(),
]);

/**
 * A delivery (PROTOCOL §4): the spec and the artifacts a delivery commits and reports, as blob refs. The commit
 * message, the PR title and the PR body are the Cell's to render from them and `.factory/`.
 * `removeTodo` is gone: an API-created order has no todo file to remove.
 */
const deliverSchema = z
  .object({
    taskId: z.string().min(1).max(128),
    type: z.string().min(1).max(32),
    title: z.string().min(1).max(256),
    todoBodyBlob: blobRefSchema,
    commitBlob: blobRefSchema.optional(),
    reportBlob: blobRefSchema.optional(),
    logCommand: z.string().min(1).max(256),
    verification: z.array(verificationSchema).max(64),
  })
  .strict();

/**
 * What a plan job needs (CORE §12.3, PROTOCOL §4): the plan's slug and title, the sub-PR list or the
 * plan PR body as a blob, and the plan PR URL once `plan_pr` reported it.
 */
const planBlockSchema = z
  .object({
    slug: planSlugSchema,
    title: z.string().min(1).max(256),
    bodyBlob: blobRefSchema.optional(),
    prUrl: z.string().min(1).max(512).optional(),
  })
  .strict();

/**
 * A Mechanic job (CORE §14.4): triages one Andon, names the Andon by its `andon_raised` time and the
 * prompt blob. May carry a `workspace` so the Mechanic can inspect and edit the Work order's worktree.
 */
const mechanicSchema = z
  .object({
    andonAt: z.number().int().min(0),
    n: z.number().int().min(1),
    /** The Andon the Mechanic triages; the Cell renders the incident prompt from it. */
    incident: z
      .object({
        reason: z.string().min(1).max(64),
        detail: z.string().max(65536),
        /** The latest `workspace_failed` behind a workspace Andon; its log is read by the Cell, not inlined. */
        workspaceFailure: z
          .object({
            stage: workspaceStageSchema,
            detail: z.string().max(65536),
            logBlob: blobRefSchema,
          })
          .strict()
          .optional(),
      })
      .strict(),
    /** The runner the Mechanic runs with: the Line's first Operator pool (CORE §14.4). */
    operator: operatorSchema,
  })
  .strict();

const WORK_KINDS = new Set([
  'run_operator_station',
  'run_inspection',
  'deliver',
]);
const PLAN_KINDS = new Set(['plan_branch', 'plan_pr', 'plan_pr_ready']);

/**
 * A job a Cell runs: PROTOCOL §4, the shape the claim and the continuation return. A Work order job
 * names an OrderId and carries its `workspace`; a plan job names a PlanId, carries a `plan` block and
 * no workspace (plan jobs work on the repo's refs only).
 */
export const jobSchema = z
  .object({
    jobId: jobIdSchema,
    orderId: z.union([orderIdSchema, planIdSchema]),
    projectId: projectIdSchema,
    epoch: z.number().int().min(1),
    kind: z.union([jobKindSchema, planJobKindSchema]),
    repo: repoSchema,
    base: z.union([
      commitShaSchema,
      z.object({ branchBase: z.string().min(1).max(128) }).strict(),
    ]),
    workspace: workspaceSchema.optional(),
    station: stationSchema.optional(),
    deliver: deliverSchema.optional(),
    plan: planBlockSchema.optional(),
    mechanic: mechanicSchema.optional(),
  })
  .strict()
  .superRefine((job, ctx) => {
    const issue = (message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: ['kind'] });
    if (job.kind === 'mechanic') {
      if (isPlanId(job.orderId)) issue('mechanic needs an OrderId');
      if (job.mechanic === undefined) issue('mechanic needs a mechanic block');
      if (job.station !== undefined) issue('mechanic has no station');
      if (job.deliver !== undefined) issue('mechanic has no deliver block');
      if (job.plan !== undefined) issue('mechanic has no plan block');
      return;
    }
    if (job.mechanic !== undefined) issue(`${job.kind} has no mechanic block`);
    if (PLAN_KINDS.has(job.kind)) {
      if (!isPlanId(job.orderId)) issue(`${job.kind} needs a PlanId`);
      if (job.plan === undefined) issue(`${job.kind} needs a plan block`);
      if (job.workspace !== undefined) issue(`${job.kind} has no workspace`);
      if (job.station !== undefined) issue(`${job.kind} has no station`);
      if (job.deliver !== undefined) issue(`${job.kind} has no deliver block`);
      if (job.kind === 'plan_pr_ready' && job.plan?.prUrl === undefined) {
        issue('plan_pr_ready needs plan.prUrl');
      }
      return;
    }
    if (WORK_KINDS.has(job.kind) && isPlanId(job.orderId)) {
      issue(`${job.kind} needs an OrderId`);
    }
    if (job.plan !== undefined) issue(`${job.kind} has no plan block`);
    if (job.workspace === undefined) issue(`${job.kind} needs a workspace`);
    if (job.kind === 'deliver') {
      if (job.deliver === undefined) issue('deliver needs a deliver block');
      if (job.station !== undefined) issue('deliver has no station');
    } else {
      if (job.station === undefined) issue(`${job.kind} needs a station`);
      if (job.deliver !== undefined) issue(`${job.kind} has no deliver block`);
    }
  });

export type Job = z.infer<typeof jobSchema>;
