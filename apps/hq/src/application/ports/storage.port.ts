import type {
  CellId,
  CommandId,
  FactoryId,
  IncidentId,
  JobId,
  OrderId,
  PlanId,
  ProjectId,
  StepId,
  TokenId,
} from '../../domain/common/brand';
import type {
  ActorKind,
  EntityType,
  StateTransitionInput,
} from '../../domain/common/events';
import type {
  FactoryProjectReport,
  JobKind,
  JobStatus,
  OrderStepState,
  TokenKind,
  WorkspaceMode,
} from '../../domain/common/vocabulary';
import type {
  IncidentReason,
  IncidentStatus,
  ResolutionAction,
  TriageOwner,
} from '../../domain/incidents/incident-rules';
import type { StationKind } from '../../domain/orders/job-transitions';
import type {
  OrderType,
  PlanState,
  Priority,
  WorkOrderState,
} from '../../domain/orders/order-state';

type WithOptional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

export type ProjectRow = {
  projectId: ProjectId;
  repoUrl: string;
  defaultBaseBranch: string;
  maxRunning: number;
  createdAt: number;
  updatedAt: number;
};

export type ProjectInsert = ProjectRow;

export type SafeTokenRow = {
  tokenId: TokenId;
  tokenHash: string;
  prefix: string;
  kind: TokenKind;
  name: string;
  scopesJson: string[];
  factoryId: FactoryId | null;
  rotatedFromId: TokenId | null;
  expiresAt: number | null;
  revokedAt: number | null;
  lastUsedAt: number | null;
  createdAt: number;
};

export type SafeTokenInsert = WithOptional<
  SafeTokenRow,
  'factoryId' | 'rotatedFromId' | 'expiresAt' | 'revokedAt' | 'lastUsedAt'
>;

export type FactoryRow = {
  factoryId: FactoryId;
  name: string;
  projectsJson: FactoryProjectReport[];
  lastSeenAt: number;
  createdAt: number;
};

export type FactoryInsert = WithOptional<FactoryRow, 'projectsJson'>;

export type OrderPlanRow = {
  planId: PlanId;
  projectId: ProjectId;
  slug: string;
  title: string;
  baseBranch: string;
  branch: string;
  branchCommitSha: string | null;
  state: PlanState;
  failureDetail: string | null;
  version: number;
  createdAt: number;
  updatedAt: number;
};

export type OrderPlanInsert = WithOptional<
  OrderPlanRow,
  'branchCommitSha' | 'failureDetail'
>;

export type WorkOrderRow = {
  orderId: OrderId;
  projectId: ProjectId;
  planId: PlanId | null;
  parentOrderId: OrderId | null;
  slug: string;
  title: string;
  type: OrderType;
  description: string;
  lineName: string;
  lineSnapshotJson: unknown;
  unavailableLineFactoriesJson: string[];
  priority: Priority;
  baseBranch: string;
  baseCommitSha: string | null;
  branch: string;
  headCommitSha: string | null;
  staleBase: number;
  state: WorkOrderState;
  currentStepIndex: number;
  pinnedFactoryId: FactoryId | null;
  worktreeResets: number;
  mechanicRuns: number;
  activeJobId: string | null;
  activeCellId: CellId | null;
  epoch: number;
  version: number;
  createdAt: number;
  updatedAt: number;
};

export type WorkOrderInsert = WithOptional<
  WorkOrderRow,
  | 'planId'
  | 'parentOrderId'
  | 'lineSnapshotJson'
  | 'baseCommitSha'
  | 'headCommitSha'
  | 'staleBase'
  | 'currentStepIndex'
  | 'pinnedFactoryId'
  | 'worktreeResets'
  | 'mechanicRuns'
  | 'activeJobId'
  | 'activeCellId'
  | 'epoch'
>;

export type OrderStepRow = {
  stepId: StepId;
  orderId: OrderId;
  stepIndex: number;
  stationId: string;
  kind: StationKind;
  runner: string | null;
  configJson: Record<string, unknown>;
  requiredFilesJson: string[];
  producedFilesJson: string[];
  state: OrderStepState;
  attemptsUsed: number;
  maxAttempts: number;
  onFailRetryStationId: string | null;
  lastCommitSha: string | null;
  lastOutputJson: unknown;
  updatedAt: number;
};

export type OrderStepInsert = WithOptional<
  OrderStepRow,
  | 'runner'
  | 'attemptsUsed'
  | 'onFailRetryStationId'
  | 'lastCommitSha'
  | 'lastOutputJson'
>;

export type JobRow = {
  jobId: JobId;
  projectId: ProjectId;
  planId: PlanId | null;
  orderId: OrderId | null;
  stepId: StepId | null;
  incidentId: IncidentId | null;
  lineName: string | null;
  kind: JobKind;
  workspaceMode: WorkspaceMode;
  status: JobStatus;
  repoUrl: string;
  baseBranch: string;
  baseCommitSha: string | null;
  targetBranch: string;
  expectedPriorStepsJson: {
    stepId: string;
    stationId: string;
    stepIndex: number;
    requiredFiles: string[];
  }[];
  payloadJson: Record<string, unknown>;
  claimedByCellId: CellId | null;
  claimedByFactoryId: FactoryId | null;
  epoch: number;
  leaseExpiresAt: number | null;
  resultCommitSha: string | null;
  resultJson: unknown;
  errorDetail: string | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
};

export type JobInsert = WithOptional<
  JobRow,
  | 'planId'
  | 'orderId'
  | 'stepId'
  | 'incidentId'
  | 'lineName'
  | 'baseCommitSha'
  | 'claimedByCellId'
  | 'claimedByFactoryId'
  | 'epoch'
  | 'leaseExpiresAt'
  | 'resultCommitSha'
  | 'resultJson'
  | 'errorDetail'
  | 'startedAt'
  | 'finishedAt'
>;

export type IncidentRow = {
  incidentId: IncidentId;
  projectId: ProjectId;
  orderId: OrderId;
  failedStepId: StepId | null;
  failedJobId: JobId | null;
  reason: IncidentReason;
  detail: string;
  status: IncidentStatus;
  triageOwner: TriageOwner;
  diagnosis: string | null;
  resolutionAction: ResolutionAction | null;
  resolvedBy: string | null;
  createdAt: number;
  resolvedAt: number | null;
};

export type IncidentInsert = WithOptional<
  IncidentRow,
  | 'failedStepId'
  | 'failedJobId'
  | 'diagnosis'
  | 'resolutionAction'
  | 'resolvedBy'
  | 'resolvedAt'
>;

export type StateTransitionRow = {
  seq: number;
  projectId: ProjectId;
  entityType: EntityType;
  entityId: string;
  fromState: string | null;
  toState: string;
  actorKind: ActorKind;
  actorId: string | null;
  commandId: string | null;
  metaJson: Record<string, unknown> | null;
  at: number;
};

export type OrderFilter = {
  projectId?: ProjectId;
  planId?: PlanId;
  parentOrderId?: OrderId | null;
  lineName?: string;
  state?: WorkOrderState;
  pinnedFactoryId?: FactoryId;
};

export type PlanFilter = {
  projectId: ProjectId;
  state?: PlanState;
};

export type IncidentFilter = {
  projectId: ProjectId;
  orderId?: OrderId;
  reason?: IncidentReason;
  status?: IncidentStatus;
};

export type ProjectReads = {
  find(projectId: ProjectId): Promise<ProjectRow | undefined>;
  list(): Promise<ProjectRow[]>;
};

export type ProjectWrites = ProjectReads & {
  insert(row: ProjectInsert): Promise<ProjectRow>;
  update(
    projectId: ProjectId,
    patch: Partial<ProjectInsert>,
  ): Promise<ProjectRow>;
};

export type TokenReads = {
  find(tokenId: TokenId): Promise<SafeTokenRow | undefined>;
  findByHash(tokenHash: string): Promise<SafeTokenRow | undefined>;
  findActiveJoin(): Promise<SafeTokenRow | undefined>;
  findSuccessor(rotatedFromId: TokenId): Promise<SafeTokenRow | undefined>;
};

export type TokenWrites = TokenReads & {
  insert(row: SafeTokenInsert): Promise<SafeTokenRow>;
  update(
    tokenId: TokenId,
    patch: Partial<SafeTokenInsert>,
  ): Promise<SafeTokenRow>;
  revokeActiveOfKind(kind: TokenKind, revokedAt: number): Promise<void>;
};

export type FactoryReads = {
  list(): Promise<FactoryRow[]>;
};

export type FactoryWrites = FactoryReads & {
  insert(row: FactoryInsert): Promise<FactoryRow>;
  update(
    factoryId: FactoryId,
    patch: Partial<FactoryInsert>,
  ): Promise<FactoryRow>;
};

export type PlanReads = {
  find(planId: PlanId): Promise<OrderPlanRow | undefined>;
  list(filter: PlanFilter): Promise<OrderPlanRow[]>;
};

export type PlanWrites = PlanReads & {
  insert(row: OrderPlanInsert): Promise<OrderPlanRow>;
  update(
    planId: PlanId,
    patch: Partial<OrderPlanInsert>,
  ): Promise<OrderPlanRow>;
};

export type OrderReads = {
  find(orderId: OrderId): Promise<WorkOrderRow | undefined>;
  list(filter: OrderFilter): Promise<WorkOrderRow[]>;
  listQueued(projectId: ProjectId): Promise<WorkOrderRow[]>;
};

export type OrderWrites = OrderReads & {
  insert(row: WorkOrderInsert): Promise<WorkOrderRow>;
  update(
    orderId: OrderId,
    patch: Partial<WorkOrderInsert>,
  ): Promise<WorkOrderRow>;
};

export type StepReads = {
  find(stepId: StepId): Promise<OrderStepRow | undefined>;
  listByOrder(orderId: OrderId): Promise<OrderStepRow[]>;
};

export type StepWrites = StepReads & {
  insertMany(rows: OrderStepInsert[]): Promise<void>;
  update(
    stepId: StepId,
    patch: Partial<OrderStepInsert>,
  ): Promise<OrderStepRow>;
};

export type JobReads = {
  find(jobId: JobId): Promise<JobRow | undefined>;
  findActiveByCell(cellId: CellId): Promise<JobRow | undefined>;
  findActiveByCellInFactory(
    cellId: CellId,
    factoryId: FactoryId,
  ): Promise<JobRow | undefined>;
  listActiveByFactory(factoryId: FactoryId): Promise<JobRow[]>;
  listExpired(now: number): Promise<JobRow[]>;
  listReadyPlanBranches(projectId: ProjectId): Promise<JobRow[]>;
  findReadyMechanic(factoryId: FactoryId): Promise<JobRow | undefined>;
  findReadyRunOperator(orderId: OrderId): Promise<JobRow | undefined>;
  findActiveMechanic(incidentId: IncidentId): Promise<JobRow | undefined>;
  listOpenMechanic(incidentId: IncidentId): Promise<JobRow[]>;
  listByOrder(orderId: OrderId): Promise<JobRow[]>;
};

export type JobWrites = JobReads & {
  insert(row: JobInsert): Promise<JobRow>;
  update(jobId: JobId, patch: Partial<JobInsert>): Promise<JobRow>;
};

export type IncidentReads = {
  find(incidentId: IncidentId): Promise<IncidentRow | undefined>;
  list(filter: IncidentFilter): Promise<IncidentRow[]>;
};

export type IncidentWrites = IncidentReads & {
  insert(row: IncidentInsert): Promise<void>;
  update(
    incidentId: IncidentId,
    patch: Partial<IncidentInsert>,
  ): Promise<IncidentRow>;
};

export type TransitionReads = {
  findByCommand(commandId: CommandId): Promise<StateTransitionRow | undefined>;
  listAfter(
    afterSeq: number,
    projectId?: ProjectId,
  ): Promise<StateTransitionRow[]>;
};

export type TransitionWrites = TransitionReads & {
  append(input: StateTransitionInput): Promise<number>;
};

export type StorageReadTx = {
  projects: ProjectReads;
  tokens: TokenReads;
  factories: FactoryReads;
  plans: PlanReads;
  orders: OrderReads;
  steps: StepReads;
  jobs: JobReads;
  incidents: IncidentReads;
  transitions: TransitionReads;
};

export type StorageWriteTx = {
  projects: ProjectWrites;
  tokens: TokenWrites;
  factories: FactoryWrites;
  plans: PlanWrites;
  orders: OrderWrites;
  steps: StepWrites;
  jobs: JobWrites;
  incidents: IncidentWrites;
  transitions: TransitionWrites;
};

export type StorageWriteOptions = {
  dryRun?: boolean;
};

// Every repo call returns a Promise: await it inside the callback, or the
// write may commit before the query runs.
export type StoragePort = {
  read<T>(fn: (tx: StorageReadTx) => T | Promise<T>): Promise<T>;
  write<T>(
    fn: (tx: StorageWriteTx) => T | Promise<T>,
    options?: StorageWriteOptions,
  ): Promise<T>;
};
