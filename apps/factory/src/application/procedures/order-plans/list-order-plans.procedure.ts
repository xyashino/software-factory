import { and, eq } from 'drizzle-orm';
import { listOrderPlansContract } from '../../../contracts/order-plans.contract';
import { asProjectId } from '../../../domain/common/brand';
import { orderPlans } from '../../../db/schema/plans';
import { scopedProcedure } from '../../core/procedure';
import { toOrderPlanDto } from '../../orders/order-views';

export const listOrderPlansProcedure = scopedProcedure(['supervisor:read'])(
  listOrderPlansContract,
)((input, ctx) => {
  const { projectId, state } = input.query;
  const rows = ctx.db
    .select()
    .from(orderPlans)
    .where(
      and(
        eq(orderPlans.projectId, asProjectId(projectId)),
        state === undefined ? undefined : eq(orderPlans.state, state),
      ),
    )
    .all();
  return { code: 200 as const, items: rows.map(toOrderPlanDto) };
});
