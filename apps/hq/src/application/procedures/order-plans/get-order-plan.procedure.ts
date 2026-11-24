import { getOrderPlanContract } from '@repo/hq-contracts/order-plans.contract';
import { scopedProcedure } from '../../core/procedure';
import { requirePlan } from '../../orders/order-writes';
import { toOrderPlanDto, toWorkOrderDto } from '../../orders/order-views';

export const getOrderPlanProcedure = scopedProcedure(['supervisor:read'])(
  getOrderPlanContract,
)(async (input, ctx) => {
  const { plan, members } = await ctx.storage.read((tx) => {
    const plan = requirePlan(tx, input.params.id);
    return {
      plan,
      members: tx.orders.list({ planId: plan.planId }),
    };
  });
  return {
    code: 200 as const,
    plan: toOrderPlanDto(plan),
    workOrders: members.map(toWorkOrderDto),
  };
});
