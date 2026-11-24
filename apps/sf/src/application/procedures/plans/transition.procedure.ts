import { z } from 'zod';
import { define } from '../../core/procedure';
import { readProjectId, readSecret } from '../../core/repo-access';
import {
  type OrderPlan,
  OrderPlanSchema,
  fetchPlans,
  planBySlug,
} from './lookup';

export const PLAN_TRANSITIONS = ['activate', 'retry'] as const;

const TransitionSchema = z
  .object({
    configPath: z.string().min(1),
    slug: z.string().trim().min(1),
    action: z.enum(PLAN_TRANSITIONS),
  })
  .strict();

const TransitionReplySchema = z.object({ plan: OrderPlanSchema });

export interface PlanTransitionResult {
  plan: OrderPlan;
}

export const transitionPlan = define({ kind: 'supervisor' })(
  TransitionSchema,
)<PlanTransitionResult>(async (input, ctx) => {
  const projectId = await readProjectId(ctx, input.configPath);
  const secret = await readSecret(ctx);
  const target = planBySlug(
    await fetchPlans(ctx, projectId, secret),
    input.slug,
  );
  const reply = await ctx.hq.call(
    `/api/v1/order-plans/${encodeURIComponent(target.planId)}/transitions`,
    { action: input.action },
    secret,
  );
  return TransitionReplySchema.parse(reply);
});
