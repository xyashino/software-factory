import { and, eq } from 'drizzle-orm';
import { listWorkOrdersContract } from '../../../contracts/work-orders.contract';
import { workOrders } from '../../../db/schema/orders';
import { asCellId, asPlanId, asProjectId } from '../../../domain/common/brand';
import { scopedProcedure } from '../../core/procedure';
import { toWorkOrderDto } from '../../orders/order-views';

export const listWorkOrdersProcedure = scopedProcedure(['supervisor:read'])(
  listWorkOrdersContract,
)((input, ctx) => {
  const query = input.query;
  const rows = ctx.db
    .select()
    .from(workOrders)
    .where(
      and(
        eq(workOrders.projectId, asProjectId(query.projectId)),
        query.planId === undefined
          ? undefined
          : eq(workOrders.planId, asPlanId(query.planId)),
        query.lineName === undefined
          ? undefined
          : eq(workOrders.lineName, query.lineName),
        query.state === undefined
          ? undefined
          : eq(workOrders.state, query.state),
        query.pinnedCellId === undefined
          ? undefined
          : eq(workOrders.pinnedCellId, asCellId(query.pinnedCellId)),
      ),
    )
    .all();
  return { code: 200 as const, items: rows.map(toWorkOrderDto) };
});
