import { listWorkOrdersContract } from '@repo/hq-contracts/work-orders.contract';
import {
  asFactoryId,
  asPlanId,
  asProjectId,
} from '../../../domain/common/brand';
import { scopedProcedure } from '../../core/procedure';
import { toWorkOrderDto } from '../../orders/order-views';

export const listWorkOrdersProcedure = scopedProcedure(['supervisor:read'])(
  listWorkOrdersContract,
)(async (input, ctx) => {
  const query = input.query;
  const rows = await ctx.storage.read((tx) =>
    tx.orders.list({
      projectId: asProjectId(query.projectId),
      planId: query.planId === undefined ? undefined : asPlanId(query.planId),
      lineName: query.lineName,
      state: query.state,
      pinnedFactoryId:
        query.pinnedFactoryId === undefined
          ? undefined
          : asFactoryId(query.pinnedFactoryId),
    }),
  );
  return { code: 200 as const, items: rows.map(toWorkOrderDto) };
});
