import { listIncidentsContract } from '@repo/hq-contracts/incidents.contract';
import { asOrderId, asProjectId } from '../../../domain/common/brand';
import { scopedProcedure } from '../../core/procedure';
import { toIncidentDto } from '../../orders/incident-views';

export const listIncidentsProcedure = scopedProcedure(['supervisor:read'])(
  listIncidentsContract,
)(async (input, ctx) => {
  const query = input.query;
  const rows = await ctx.storage.read((tx) =>
    tx.incidents.list({
      projectId: asProjectId(query.projectId),
      orderId:
        query.orderId === undefined ? undefined : asOrderId(query.orderId),
      reason: query.reason,
      status: query.status,
    }),
  );
  return { code: 200 as const, items: rows.map(toIncidentDto) };
});
