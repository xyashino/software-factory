import {
  asIncidentId,
  asJobId,
  type FactoryId,
  type IncidentId,
  type JobId,
  type OrderId,
  type ProjectId,
  type StepId,
} from '../../domain/common/brand';
import type {
  IncidentReason,
  IncidentSnapshot,
  WorkOrderSnapshot,
} from '../../domain/incidents/incident-rules';
import type { OrderStep } from '../../domain/orders/job-transitions';
import type {
  IncidentRow,
  OrderStepRow,
  StorageWriteTx,
  WorkOrderRow,
} from '../ports/storage.port';

export type OpenIncident = {
  projectId: ProjectId;
  orderId: OrderId;
  failedStepId: StepId | null;
  failedJobId: JobId | null;
  reason: IncidentReason;
  detail: string;
  triage: Pick<IncidentSnapshot, 'status' | 'triageOwner'>;
};

export const toOrderSteps = (rows: readonly OrderStepRow[]): OrderStep[] =>
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
  steps: readonly OrderStepRow[],
): WorkOrderSnapshot => ({
  state: order.state,
  currentStepIndex: order.currentStepIndex,
  mechanicRuns: order.mechanicRuns,
  pinnedFactoryId: order.pinnedFactoryId,
  unavailableLineFactories: order.unavailableLineFactoriesJson,
  staleBase: order.staleBase,
  worktreeResets: order.worktreeResets,
  steps: toOrderSteps(steps),
});

export const toIncidentSnapshot = (
  incident: IncidentRow,
  steps: readonly OrderStepRow[],
): IncidentSnapshot => ({
  status: incident.status,
  triageOwner: incident.triageOwner,
  failedStepIndex:
    steps.find((step) => step.stepId === incident.failedStepId)?.stepIndex ??
    null,
  resolutionAction: incident.resolutionAction,
});

export const openIncident = async (
  tx: StorageWriteTx,
  input: OpenIncident,
  now: number,
): Promise<IncidentId> => {
  const { triage, ...row } = input;
  const incidentId = asIncidentId(`inc-${crypto.randomUUID()}`);
  await tx.incidents.insert({
    ...row,
    incidentId,
    status: triage.status,
    triageOwner: triage.triageOwner,
    createdAt: now,
  });
  return incidentId;
};

export const insertMechanicJob = async (
  tx: StorageWriteTx,
  order: WorkOrderRow,
  input: {
    incidentId: IncidentId;
    factoryId: FactoryId;
    repoUrl: string;
    reason: string;
    detail: string;
  },
  now: number,
): Promise<void> => {
  await tx.jobs.insert({
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
    claimedByFactoryId: input.factoryId,
    epoch: 0,
    createdAt: now,
  });
};
