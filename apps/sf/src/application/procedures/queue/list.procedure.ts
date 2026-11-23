import { z } from 'zod';
import { WORK_ORDER_STATES } from '@repo/hq-contracts/enums/orders';
import { slugSchema } from '@repo/zod-contract-kit/fields';
import { ArgumentError } from '../../core/errors';
import { define } from '../../core/procedure';
import { readProjectId, readSecret } from '../../core/repo-access';

const WORK_ORDERS_ROUTE = '/api/v1/work-orders';
const ORDER_PLANS_ROUTE = '/api/v1/order-plans';

const ListSchema = z
  .object({
    configPath: z.string().min(1),
    state: z.enum(WORK_ORDER_STATES).optional(),
    line: slugSchema.optional(),
    plan: slugSchema.optional(),
  })
  .strict();

const WorkOrdersReplySchema = z.object({
  items: z.array(
    z.looseObject({
      orderId: z.string(),
      state: z.string(),
      lineName: z.string(),
      priority: z.string(),
      planId: z.string().nullable(),
      activeCellId: z.string().nullable(),
    }),
  ),
});

const OrderPlansReplySchema = z.object({
  items: z.array(z.looseObject({ planId: z.string(), slug: z.string() })),
});

export interface QueueRow {
  orderId: string;
  state: string;
  line: string;
  priority: string;
  plan: string | null;
  activeCellId: string | null;
}

export interface QueueListResult {
  projectId: string;
  rows: QueueRow[];
}

const queryOf = (entries: Record<string, string | undefined>) =>
  Object.fromEntries(
    Object.entries(entries).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );

export const listQueue = define({ kind: 'operator' })(
  ListSchema,
)<QueueListResult>(async (input, ctx) => {
  const projectId = await readProjectId(ctx, input.configPath);
  const secret = await readSecret(ctx);
  const plans = OrderPlansReplySchema.parse(
    await ctx.hq.get(ORDER_PLANS_ROUTE, { projectId }, secret),
  ).items;
  const planIdOf = input.plan
    ? plans.find((plan) => plan.slug === input.plan)?.planId
    : undefined;
  if (input.plan && planIdOf === undefined) {
    throw new ArgumentError(`no plan with slug ${input.plan}`);
  }
  const orders = WorkOrdersReplySchema.parse(
    await ctx.hq.get(
      WORK_ORDERS_ROUTE,
      queryOf({
        projectId,
        planId: planIdOf,
        lineName: input.line,
        state: input.state,
      }),
      secret,
    ),
  ).items;
  const slugOf = new Map(plans.map((plan) => [plan.planId, plan.slug]));
  return {
    projectId,
    rows: orders.map((order) => ({
      orderId: order.orderId,
      state: order.state,
      line: order.lineName,
      priority: order.priority,
      plan: order.planId === null ? null : (slugOf.get(order.planId) ?? null),
      activeCellId: order.activeCellId,
    })),
  };
});
