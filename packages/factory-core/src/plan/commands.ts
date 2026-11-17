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
import { freeText, prUrl, shortText } from '../order/events';
import { memberStateSchema } from './events';

const prStateSchema = z.enum(['open', 'merged', 'closed']);

/** Commands on an Order Plan. Each is refused by `decide` when its precondition fails. */
export const planCommandSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('CreatePlan'),
      planId: planIdSchema,
      projectId: projectIdSchema,
      slug: planSlugSchema,
      baseBranch: shortText,
    })
    .strict(),
  z
    .object({
      type: z.literal('AddPlanMember'),
      orderId: orderIdSchema,
      todoId: todoIdSchema,
      after: orderIdSchema.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('RecordMemberState'),
      orderId: orderIdSchema,
      state: memberStateSchema,
    })
    .strict(),
  z.object({ type: z.literal('ClaimJob'), cellId: cellIdSchema }).strict(),
  z
    .object({ type: z.literal('ReportPlanBranch'), commit: commitShaSchema })
    .strict(),
  z.object({ type: z.literal('ReportPlanPr'), prUrl }).strict(),
  z.object({ type: z.literal('ReportPlanReady') }).strict(),
  z
    .object({ type: z.literal('ReportPlanJobFailed'), detail: freeText })
    .strict(),
  z
    .object({
      type: z.literal('RecordPlanPrState'),
      prUrl,
      state: prStateSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('ExpireLease'),
      jobId: jobIdSchema,
      epoch: z.number().int().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal('ReleaseJob'),
      jobId: jobIdSchema,
      epoch: z.number().int().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal('Resume'),
      resumeId: resumeIdSchema,
      by: shortText,
    })
    .strict(),
  z.object({ type: z.literal('Cancel'), reason: freeText }).strict(),
]);

export type PlanCommand = z.infer<typeof planCommandSchema>;
export type PlanCommandType = PlanCommand['type'];
