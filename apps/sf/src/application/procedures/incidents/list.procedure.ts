import { z } from 'zod';
import {
  INCIDENT_REASONS,
  INCIDENT_STATUSES,
} from '@repo/factory-contracts/enums/incidents';
import { define } from '../../core/procedure';
import { readProjectId, readSecret } from '../../core/repo-access';

const INCIDENTS_ROUTE = '/api/v1/incidents';

const ListSchema = z
  .object({
    configPath: z.string().min(1),
    project: z.string().trim().min(1).optional(),
    order: z.string().trim().min(1).optional(),
    reason: z.enum(INCIDENT_REASONS).optional(),
    status: z.enum(INCIDENT_STATUSES).optional(),
  })
  .strict();

const IncidentsReplySchema = z.object({
  items: z.array(
    z.object({
      incidentId: z.string(),
      orderId: z.string(),
      reason: z.string(),
      status: z.string(),
      triageOwner: z.string(),
    }),
  ),
});

export interface IncidentRow {
  incidentId: string;
  orderId: string;
  reason: string;
  status: string;
  triageOwner: string;
}

export interface IncidentListResult {
  projectId: string;
  rows: IncidentRow[];
}

const queryOf = (entries: Record<string, string | undefined>) =>
  Object.fromEntries(
    Object.entries(entries).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );

export const listIncidents = define({ kind: 'supervisor' })(
  ListSchema,
)<IncidentListResult>(async (input, ctx) => {
  const projectId =
    input.project ?? (await readProjectId(ctx, input.configPath));
  const secret = await readSecret(ctx);
  const reply = IncidentsReplySchema.parse(
    await ctx.server.get(
      INCIDENTS_ROUTE,
      queryOf({
        projectId,
        orderId: input.order,
        reason: input.reason,
        status: input.status,
      }),
      secret,
    ),
  );
  return { projectId, rows: reply.items };
});
