import type { DbTx } from '../../db/client';
import { incidents } from '../../db/schema/incidents';
import {
  asIncidentId,
  type JobId,
  type OrderId,
  type ProjectId,
  type StepId,
} from '../../domain/common/brand';

type IncidentInsert = typeof incidents.$inferInsert;

export type OpenIncident = {
  projectId: ProjectId;
  orderId: OrderId;
  failedStepId: StepId | null;
  failedJobId: JobId | null;
  reason: IncidentInsert['reason'];
  detail: string;
};

export const openIncident = (
  tx: DbTx,
  input: OpenIncident,
  now: number,
): void => {
  tx.insert(incidents)
    .values({
      ...input,
      incidentId: asIncidentId(`inc-${crypto.randomUUID()}`),
      status: 'open',
      triageOwner: 'mechanic',
      createdAt: now,
    })
    .run();
};
