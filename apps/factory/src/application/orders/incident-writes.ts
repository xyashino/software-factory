import type { DbTx } from '../../db/client';
import { incidents } from '../../db/schema/incidents';
import { jobs } from '../../db/schema/jobs';
import { orderSteps } from '../../db/schema/orders';
import {
  asIncidentId,
  asJobId,
  type CellId,
  type IncidentId,
  type JobId,
  type OrderId,
  type ProjectId,
  type StepId,
} from '../../domain/common/brand';
import type {
  IncidentSnapshot,
  WorkOrderSnapshot,
} from '../../domain/incidents/incident-rules';
import type { OrderStep } from '../../domain/orders/job-transitions';
import type { WorkOrderRow } from './order-views';

type IncidentInsert = typeof incidents.$inferInsert;
type IncidentRow = typeof incidents.$inferSelect;
type StepRow = typeof orderSteps.$inferSelect;

export type OpenIncident = {
  projectId: ProjectId;
  orderId: OrderId;
  failedStepId: StepId | null;
  failedJobId: JobId | null;
  reason: IncidentInsert['reason'];
  detail: string;
  triage: Pick<IncidentSnapshot, 'status' | 'triageOwner'>;
};

export const toOrderSteps = (rows: readonly StepRow[]): OrderStep[] =>
  rows.map((row) => ({
    stepIndex: row.stepIndex,
    stationId: row.stationId,
    kind: row.kind,
    requiredFiles: row.requiredFilesJson,
    maxAttempts: row.maxAttempts,
    onFailRetryStationId: row.onFailRetryStationId,
    attemptsUsed: row.attemptsUsed,
  }));

export const toWorkOrderSnapshot = (
  order: WorkOrderRow,
  steps: readonly StepRow[],
): WorkOrderSnapshot => ({
  state: order.state,
  currentStepIndex: order.currentStepIndex,
  mechanicRuns: order.mechanicRuns,
  pinnedCellId: order.pinnedCellId,
  unavailableLineCells: order.unavailableLineCellsJson,
  staleBase: order.staleBase,
  worktreeResets: order.worktreeResets,
  steps: toOrderSteps(steps),
});

export const toIncidentSnapshot = (
  incident: IncidentRow,
  steps: readonly StepRow[],
): IncidentSnapshot => ({
  status: incident.status,
  triageOwner: incident.triageOwner,
  failedStepIndex:
    steps.find((step) => step.stepId === incident.failedStepId)?.stepIndex ??
    null,
  resolutionAction: incident.resolutionAction,
});

export const openIncident = (
  tx: DbTx,
  input: OpenIncident,
  now: number,
): IncidentId => {
  const { triage, ...row } = input;
  const incidentId = asIncidentId(`inc-${crypto.randomUUID()}`);
  tx.insert(incidents)
    .values({
      ...row,
      incidentId,
      status: triage.status,
      triageOwner: triage.triageOwner,
      createdAt: now,
    })
    .run();
  return incidentId;
};

export const insertMechanicJob = (
  tx: DbTx,
  order: WorkOrderRow,
  input: {
    incidentId: IncidentId;
    cellId: CellId;
    repoUrl: string;
    reason: string;
    detail: string;
  },
  now: number,
): void => {
  tx.insert(jobs)
    .values({
      jobId: asJobId(`job-${crypto.randomUUID()}`),
      projectId: order.projectId,
      orderId: order.orderId,
      incidentId: input.incidentId,
      kind: 'mechanic',
      workspaceMode: 'reuse',
      status: 'ready',
      repoUrl: input.repoUrl,
      baseBranch: order.baseBranch,
      baseCommitSha: order.baseCommitSha,
      targetBranch: order.branch,
      expectedPriorStepsJson: [],
      payloadJson: {
        lineName: order.lineName,
        incident: { reason: input.reason, detail: input.detail },
      },
      cellId: input.cellId,
      epoch: 0,
      createdAt: now,
    })
    .run();
};
