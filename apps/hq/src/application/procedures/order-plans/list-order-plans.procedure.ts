import { listOrderPlansContract } from '@repo/hq-contracts/order-plans.contract';
import { asProjectId } from '../../../domain/common/brand';
import { scopedProcedure } from '../../core/procedure';
import { toOrderPlanDto } from '../../orders/order-views';

export const listOrderPlansProcedure = scopedProcedure(['supervisor:read'])(
  listOrderPlansContract,
)(async (input, ctx) => {
  const { projectId, state } = input.query;
  const rows = await ctx.storage.read((tx) =>
    tx.plans.list({ projectId: asProjectId(projectId), state }),
  );
  return { code: 200 as const, items: rows.map(toOrderPlanDto) };
});
