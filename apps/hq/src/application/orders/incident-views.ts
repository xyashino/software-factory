import type { incidents } from '../../db/schema/incidents';

type IncidentRow = typeof incidents.$inferSelect;

export const toIncidentDto = (row: IncidentRow) => ({
  incidentId: row.incidentId,
  projectId: row.projectId,
  orderId: row.orderId,
  failedStepId: row.failedStepId,
  failedJobId: row.failedJobId,
  reason: row.reason,
  detail: row.detail,
  status: row.status,
  triageOwner: row.triageOwner,
  diagnosis: row.diagnosis,
  resolutionAction: row.resolutionAction,
  resolvedBy: row.resolvedBy,
  createdAt: row.createdAt,
  resolvedAt: row.resolvedAt,
});
