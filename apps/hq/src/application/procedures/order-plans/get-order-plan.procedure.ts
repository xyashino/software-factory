import { eq } from 'drizzle-orm';
import { getOrderPlanContract } from '@repo/hq-contracts/order-plans.contract';
import { workOrders } from '../../../db/schema/orders';
import { scopedProcedure } from '../../core/procedure';
import { requirePlan } from '../../orders/order-writes';
import { toOrderPlanDto, toWorkOrderDto } from '../../orders/order-views';

export const getOrderPlanProcedure = scopedProcedure(['supervisor:read'])(
  getOrderPlanContract,
)((input, ctx) => {
  const plan = requirePlan(ctx.db, input.params.id);
  const members = ctx.db
    .select()
    .from(workOrders)
    .where(eq(workOrders.planId, plan.planId))
    .all();
  return {
    code: 200 as const,
    plan: toOrderPlanDto(plan),
    workOrders: members.map(toWorkOrderDto),
  };
});
