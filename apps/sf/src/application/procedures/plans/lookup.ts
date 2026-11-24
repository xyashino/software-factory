import { z } from 'zod';
import { ArgumentError } from '../../core/errors';
import type { Ports } from '../../core/procedure';

const ORDER_PLANS_ROUTE = '/api/v1/order-plans';

export const OrderPlanSchema = z.looseObject({
  planId: z.string(),
  slug: z.string(),
  title: z.string(),
  branch: z.string(),
  baseBranch: z.string(),
  state: z.string(),
  branchCommitSha: z.string().nullable(),
  failureDetail: z.string().nullable(),
});

const OrderPlansReplySchema = z.object({
  items: z.array(OrderPlanSchema),
});

export type OrderPlan = z.infer<typeof OrderPlanSchema>;

export const fetchPlans = async (
  ctx: Ports,
  projectId: string,
  secret: string,
): Promise<OrderPlan[]> =>
  OrderPlansReplySchema.parse(
    await ctx.hq.get(ORDER_PLANS_ROUTE, { projectId }, secret),
  ).items;

export const planBySlug = (plans: OrderPlan[], slug: string): OrderPlan => {
  const plan = plans.find((candidate) => candidate.slug === slug);
  if (plan === undefined) {
    throw new ArgumentError(`no plan with slug ${slug}`);
  }
  return plan;
};
