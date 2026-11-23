import { and, eq } from 'drizzle-orm';
import { listIncidentsContract } from '@repo/hq-contracts/incidents.contract';
import { incidents } from '../../../db/schema/incidents';
import { asOrderId, asProjectId } from '../../../domain/common/brand';
import { scopedProcedure } from '../../core/procedure';
import { toIncidentDto } from '../../orders/incident-views';

export const listIncidentsProcedure = scopedProcedure(['operator:read'])(
  listIncidentsContract,
)((input, ctx) => {
  const query = input.query;
  const rows = ctx.db
    .select()
    .from(incidents)
    .where(
      and(
        eq(incidents.projectId, asProjectId(query.projectId)),
        query.orderId === undefined
          ? undefined
          : eq(incidents.orderId, asOrderId(query.orderId)),
        query.reason === undefined
          ? undefined
          : eq(incidents.reason, query.reason),
        query.status === undefined
          ? undefined
          : eq(incidents.status, query.status),
      ),
    )
    .all();
  return { code: 200 as const, items: rows.map(toIncidentDto) };
});
