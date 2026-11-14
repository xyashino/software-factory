import { z } from 'zod';
import {
  cellIdSchema,
  commitShaSchema,
  jobIdSchema,
  orderIdSchema,
  planIdSchema,
  planSlugSchema,
  projectIdSchema,
  resumeIdSchema,
  todoIdSchema,
} from '../ids';
import { actorSchema, freeText, prUrl, shortText } from '../order/events';

const nonNegativeInt = z.number().int().min(0);
const positiveInt = z.number().int().min(1);

/** CORE §12.3: the job kinds a plan runs on a Cell. */
export const planJobKindSchema = z.enum([
  'plan_branch',
  'plan_pr',
  'plan_pr_ready',
]);

/** CORE §12.3: why the plan needs the Supervisor. */
export const planAndonReasonSchema = z.enum([
  'plan_job_failed',
  'plan_pr_closed',
]);

/** CORE §12.3: the state a member reports to its plan. */
export const memberStateSchema = z.enum([
  'open',
  'delivered',
  'merged',
  'closed',
  'cancelled',
]);

const planCreatedSchema = z
  .object({
    type: z.literal('plan_created'),
    projectId: projectIdSchema,
    slug: planSlugSchema,
    branch: shortText,
    baseBranch: shortText,
  })
  .strict();
const planMemberAddedSchema = z
  .object({
    type: z.literal('plan_member_added'),
    orderId: orderIdSchema,
    todoId: todoIdSchema,
    after: orderIdSchema.optional(),
  })
  .strict();
const planMemberStateChangedSchema = z
  .object({
    type: z.literal('plan_member_state_changed'),
    orderId: orderIdSchema,
    state: memberStateSchema,
  })
  .strict();
const planBranchCreatedSchema = z
  .object({ type: z.literal('plan_branch_created'), commit: commitShaSchema })
  .strict();
const planPrOpenedSchema = z
  .object({ type: z.literal('plan_pr_opened'), prUrl })
  .strict();
const planPrReadySchema = z
  .object({ type: z.literal('plan_pr_ready') })
  .strict();
const planPrStateChangedSchema = z
  .object({
    type: z.literal('plan_pr_state_changed'),
    prUrl,
    state: z.enum(['open', 'merged', 'closed']),
  })
  .strict();
const planCompletedSchema = z
  .object({ type: z.literal('plan_completed') })
  .strict();
const planCancelledSchema = z
  .object({ type: z.literal('plan_cancelled'), reason: freeText })
  .strict();
const jobClaimedSchema = z
  .object({
    type: z.literal('job_claimed'),
    jobId: jobIdSchema,
    kind: planJobKindSchema,
    cellId: cellIdSchema,
    epoch: positiveInt,
  })
  .strict();
const jobLostSchema = z
  .object({
    type: z.literal('job_lost'),
    jobId: jobIdSchema,
    epoch: positiveInt,
    reason: z.enum(['lease_expired', 'cell_left', 'cancelled']),
  })
  .strict();
const planJobFailedSchema = z
  .object({
    type: z.literal('plan_job_failed'),
    jobId: jobIdSchema,
    kind: planJobKindSchema,
    detail: freeText,
  })
  .strict();
const andonRaisedSchema = z
  .object({
    type: z.literal('andon_raised'),
    reason: planAndonReasonSchema,
    detail: freeText,
  })
  .strict();
const resumedSchema = z
  .object({
    type: z.literal('resumed'),
    resumeId: resumeIdSchema,
    by: shortText,
    mode: z.object({ kind: z.literal('retry_station') }).strict(),
  })
  .strict();

/** CORE §12.3 events of an Order Plan Traveler, discriminated by `type`. */
export const planEventSchema = z.discriminatedUnion('type', [
  planCreatedSchema,
  planMemberAddedSchema,
  planMemberStateChangedSchema,
  planBranchCreatedSchema,
  planPrOpenedSchema,
  planPrReadySchema,
  planPrStateChangedSchema,
  planCompletedSchema,
  planCancelledSchema,
  jobClaimedSchema,
  jobLostSchema,
  planJobFailedSchema,
  andonRaisedSchema,
  resumedSchema,
]);

/** The envelope of a plan event (CORE §3.1). `planId` is the stream id; the events table stores it in `order_id`. */
export const planStoredEventSchema = z
  .object({
    schemaVersion: z.literal(2),
    seq: positiveInt,
    globalSeq: positiveInt,
    planId: planIdSchema,
    at: nonNegativeInt,
    actor: actorSchema,
    commandId: shortText,
    epoch: positiveInt.optional(),
    event: planEventSchema,
  })
  .strict();

export type PlanJobKind = z.infer<typeof planJobKindSchema>;
export type PlanAndonReason = z.infer<typeof planAndonReasonSchema>;
export type MemberState = z.infer<typeof memberStateSchema>;
export type PlanEvent = z.infer<typeof planEventSchema>;
export type PlanEventType = PlanEvent['type'];
export type StoredPlanEvent = z.infer<typeof planStoredEventSchema>;
