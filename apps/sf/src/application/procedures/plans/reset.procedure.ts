import { z } from 'zod';
import { WORK_ORDER_STATES } from '@repo/hq-contracts/enums/orders';
import { ArgumentError } from '../../core/errors';
import { define } from '../../core/procedure';
import { readProjectId, readSecret } from '../../core/repo-access';
import {
  type OrderPlan,
  OrderPlanSchema,
  fetchPlans,
  planBySlug,
} from './lookup';

const ResetSchema = z
  .object({
    configPath: z.string().min(1),
    slug: z.string().trim().min(1),
    yes: z.boolean(),
  })
  .strict();

const ChildSchema = z.object({
  slug: z.string(),
  state: z.enum(WORK_ORDER_STATES),
});

const ResetReplySchema = z.object({
  plan: OrderPlanSchema,
  reset: z.array(ChildSchema),
  skipped: z.array(ChildSchema),
});

export type ResetChild = z.infer<typeof ChildSchema>;

export interface PlanResetResult {
  plan: OrderPlan;
  reset: ResetChild[];
  skipped: ResetChild[];
}

export const resetPlan = define({ kind: 'supervisor' })(
  ResetSchema,
)<PlanResetResult>(async (input, ctx) => {
  if (!input.yes) {
    throw new ArgumentError(
      `reset would restart plan ${input.slug} from scratch. Re-run with --yes`,
    );
  }
  const projectId = await readProjectId(ctx, input.configPath);
  const secret = await readSecret(ctx);
  const target = planBySlug(
    await fetchPlans(ctx, projectId, secret),
    input.slug,
  );
  const reply = await ctx.hq.call(
    `/api/v1/order-plans/${encodeURIComponent(target.planId)}/transitions`,
    { action: 'reset' },
    secret,
  );
  return ResetReplySchema.parse(reply);
});
