import type { z } from 'zod';
import { LEASE_TTL_MS } from '../../../config';
import { transitionJobContract } from '@repo/hq-contracts/jobs.contract';
import {
  asCommandId,
  asFactoryId,
  asJobId,
  asStepId,
  type CellId,
  type CommandId,
  type FactoryId,
  type OrderId,
  type ProjectId,
  type StepId,
} from '../../../domain/common/brand';
import { addMs } from '../../../domain/common/time';
import { triageIncident } from '../../../domain/incidents/incident-rules';
import {
  assertArtifactsProduced,
  materializeLineSnapshot,
  planStepFailure,
  planWorktreeMissing,
  UnprocessableTransition,
  type OrderStep,
} from '../../../domain/orders/job-transitions';
import { stepJobPayload } from '../../orders/job-payload';
import {
  Conflict,
  InternalServer,
  NotFound,
  StaleLeaseEpoch,
} from '../../core/error-handling';
import { scopedProcedure } from '../../core/procedure';
import type {
  JobRow,
  OrderFilter,
  OrderStepInsert,
  OrderStepRow,
  StorageWriteTx,
  WorkOrderInsert,
  WorkOrderRow,
} from '../../ports/storage.port';
import {
  flushTransitions,
  orderTransition,
  publishCommitted,
  requireOrder,
  requirePlan,
  requireProject,
  settle,
  updateWorkOrder,
  type Actor,
  type TransitionLog,
} from '../../orders/order-writes';
import {
  insertMechanicJob,
  openIncident,
  toOrderSteps,
  toWorkOrderSnapshot,
  type OpenIncident,
} from '../../orders/incident-writes';
import { toClaimedJob } from '../cells/claim-job.procedure';
import {
  cellIdOf,
  factoryIdOf,
  isSilent,
  touchFactory,
} from '../../core/identity';

const JOB_KIND_BY_STEP_KIND = {
  operator: 'run_operator',
  inspection: 'run_inspection',
  deliver: 'deliver',
} as const;

type TransitionBody = z.infer<typeof transitionJobContract.in.body>;
type TransitionResponse = z.infer<(typeof transitionJobContract.out)[200]>;
type ClaimedJob = ReturnType<typeof toClaimedJob>;
type StartInput = { lineSnapshot?: unknown };
type CompleteInput = {
  producedFiles: string[];
  commitSha?: string;
  output?: Record<string, unknown>;
};
type Completion = {
  projectId: ProjectId;
  cellId: CellId;
  commitSha: string;
  output: Record<string, unknown> | null;
  producedFiles: string[];
  now: number;
};

type FailInput = {
  detail: string;
  output?: Record<string, unknown>;
  workspaceFailed?: boolean;
};
type BlockInput = { detail: string; handoverFile?: string };
type WorktreeMissingInput = { missingStepId: string; missingFiles: string[] };
type LineUnavailableInput = { lineName: string; detail: string };
type IssueInput = {
  cellId: CellId;
  workspaceMode: JobRow['workspaceMode'];
  now: number;
  log: TransitionLog;
  orderPatch: Partial<WorkOrderInsert>;
};
type BlockedAction = 'fail' | 'block' | 'worktree_missing';

const cellActor = (cellId: CellId): Actor => ({ kind: 'cell', id: cellId });

const startedResponse = (): TransitionResponse => ({
  code: 200,
  action: 'start',
  status: 'running',
});

const completedResponse = (nextJob: ClaimedJob | null): TransitionResponse => ({
  code: 200,
  action: 'complete',
  completed: true,
  nextJob,
});

const failedResponse = (nextJob: ClaimedJob): TransitionResponse => ({
  code: 200,
  action: 'fail',
  failed: true,
  nextJob,
});

const blockedResponse = (action: BlockedAction): TransitionResponse => ({
  code: 200,
  action,
  blocked: true,
});

const resetResponse = (nextJob: ClaimedJob): TransitionResponse => ({
  code: 200,
  action: 'worktree_missing',
  resetToScratch: true,
  nextJob,
});

const lineUnavailableResponse = (
  nextJob: ClaimedJob | null,
): TransitionResponse => ({
  code: 200,
  action: 'line_unavailable',
  markedLineUnavailable: true,
  nextJob,
});

const requireJob = async (
  tx: StorageWriteTx,
  jobId: string,
): Promise<JobRow> => {
  const row = await tx.jobs.find(asJobId(jobId));
  if (row === undefined) throw new NotFound(`Job ${jobId} not found`);
  return row;
};

const findReplay = async (
  tx: StorageWriteTx,
  commandId: CommandId,
  jobId: string,
): Promise<TransitionResponse | undefined> => {
  const prior = await tx.transitions.findByCommand(commandId);
  if (prior === undefined) return undefined;
  if (prior.entityId !== jobId)
    throw new Conflict(`commandId ${commandId} belongs to another transition`);
  const replay = transitionJobContract.out[200].safeParse(
    prior.metaJson?.result,
  );
  if (!replay.success)
    throw new InternalServer('Stored transition result is unreadable');
  return replay.data;
};

const fence = (job: JobRow, cellId: CellId, epoch: number): void => {
  if (job.claimedByCellId !== cellId || job.epoch !== epoch)
    throw new StaleLeaseEpoch(`Job ${job.jobId} epoch ${epoch} is stale`);
};

const requireStatus = (job: JobRow, ...statuses: JobRow['status'][]): void => {
  if (!statuses.includes(job.status))
    throw new Conflict(`Job ${job.jobId} cannot transition from ${job.status}`);
};

const requireCommitSha = (commitSha: string | undefined): string => {
  if (commitSha === undefined)
    throw new UnprocessableTransition('commitSha is required to complete');
  return commitSha;
};

const orderIdOf = (job: JobRow): OrderId => {
  if (job.orderId === null)
    throw new Conflict(`Job ${job.jobId} has no work order`);
  return job.orderId;
};

const stepAt = (
  steps: readonly OrderStepRow[],
  stepIndex: number,
): OrderStepRow => {
  const step = steps.find((candidate) => candidate.stepIndex === stepIndex);
  if (step === undefined)
    throw new UnprocessableTransition(`no step at index ${stepIndex}`);
  return step;
};

const boundStep = async (
  tx: StorageWriteTx,
  job: JobRow,
): Promise<OrderStepRow> => {
  if (job.stepId === null)
    throw new Conflict(`Job ${job.jobId} has no bound step`);
  const row = await tx.steps.find(job.stepId);
  if (row === undefined) throw new NotFound(`Step ${job.stepId} not found`);
  return row;
};

const insertSteps = (
  tx: StorageWriteTx,
  orderId: OrderId,
  steps: readonly OrderStep[],
  now: number,
): Promise<void> =>
  tx.steps.insertMany(
    steps.map((step): OrderStepInsert => ({
      stepId: asStepId(`step-${crypto.randomUUID()}`),
      orderId,
      stepIndex: step.stepIndex,
      stationId: step.stationId,
      kind: step.kind,
      configJson: {},
      requiredFilesJson: step.requiredFiles,
      producedFilesJson: [],
      state: 'pending',
      attemptsUsed: 0,
      maxAttempts: step.maxAttempts,
      onFailRetryStationId: step.onFailRetryStationId,
      updatedAt: now,
    })),
  );

const finishJob = async (
  tx: StorageWriteTx,
  job: JobRow,
  completion: Completion,
  log: TransitionLog,
): Promise<void> => {
  await tx.jobs.update(job.jobId, {
    status: 'passed',
    resultCommitSha: completion.commitSha,
    resultJson: completion.output,
    finishedAt: completion.now,
  });
  log.push(
    orderTransition({
      projectId: completion.projectId,
      entityType: 'job',
      entityId: job.jobId,
      fromState: job.status,
      toState: 'passed',
      actor: cellActor(completion.cellId),
      at: completion.now,
    }),
  );
};

const finishStep = async (
  tx: StorageWriteTx,
  step: OrderStepRow,
  completion: Completion,
  log: TransitionLog,
): Promise<void> => {
  await tx.steps.update(step.stepId, {
    state: 'passed',
    producedFilesJson: completion.producedFiles,
    lastCommitSha: completion.commitSha,
    lastOutputJson: completion.output,
    updatedAt: completion.now,
  });
  log.push(
    orderTransition({
      projectId: completion.projectId,
      entityType: 'order_step',
      entityId: step.stepId,
      fromState: step.state,
      toState: 'passed',
      actor: cellActor(completion.cellId),
      at: completion.now,
    }),
  );
};

const unlockWaitingOrders = async (
  tx: StorageWriteTx,
  filter: OrderFilter,
  patch: Partial<WorkOrderInsert>,
  completion: Completion,
  log: TransitionLog,
): Promise<void> => {
  const rows = await tx.orders.list({ ...filter, state: 'waiting_parent' });
  for (const row of rows) {
    await updateWorkOrder(
      tx,
      row,
      { ...patch, state: 'queued' },
      completion.now,
    );
    log.push(
      orderTransition({
        projectId: row.projectId,
        entityType: 'work_order',
        entityId: row.orderId,
        fromState: 'waiting_parent',
        toState: 'queued',
        actor: cellActor(completion.cellId),
        at: completion.now,
      }),
    );
  }
};

const startJob = async (
  tx: StorageWriteTx,
  job: JobRow,
  cellId: CellId,
  body: StartInput,
  now: number,
  log: TransitionLog,
): Promise<TransitionResponse> => {
  requireStatus(job, 'claimed');
  const actor = cellActor(cellId);
  if (job.kind === 'plan_branch' || job.kind === 'mechanic') {
    await tx.jobs.update(job.jobId, { status: 'running' });
    log.push(
      orderTransition({
        projectId: job.projectId,
        entityType: 'job',
        entityId: job.jobId,
        fromState: job.status,
        toState: 'running',
        actor,
        at: now,
      }),
    );
    return startedResponse();
  }

  const order = await requireOrder(tx, orderIdOf(job));
  let steps = await tx.steps.listByOrder(order.orderId);
  if (steps.length === 0 && order.currentStepIndex === 0) {
    await insertSteps(
      tx,
      order.orderId,
      materializeLineSnapshot(body.lineSnapshot),
      now,
    );
    steps = await tx.steps.listByOrder(order.orderId);
  }
  const step = stepAt(steps, order.currentStepIndex);

  await tx.jobs.update(job.jobId, { status: 'running', stepId: step.stepId });
  log.push(
    orderTransition({
      projectId: job.projectId,
      entityType: 'job',
      entityId: job.jobId,
      fromState: job.status,
      toState: 'running',
      actor,
      at: now,
    }),
  );
  await tx.steps.update(step.stepId, { state: 'running', updatedAt: now });
  log.push(
    orderTransition({
      projectId: job.projectId,
      entityType: 'order_step',
      entityId: step.stepId,
      fromState: step.state,
      toState: 'running',
      actor,
      at: now,
    }),
  );
  return startedResponse();
};

const completePlanBranch = async (
  tx: StorageWriteTx,
  job: JobRow,
  completion: Completion,
  log: TransitionLog,
): Promise<TransitionResponse> => {
  if (job.planId === null)
    throw new Conflict(`Job ${job.jobId} has no order plan`);
  const plan = await requirePlan(tx, job.planId);
  await finishJob(tx, job, completion, log);
  await tx.plans.update(plan.planId, {
    state: 'active',
    branchCommitSha: completion.commitSha,
    version: plan.version + 1,
    updatedAt: completion.now,
  });
  log.push(
    orderTransition({
      projectId: plan.projectId,
      entityType: 'order_plan',
      entityId: plan.planId,
      fromState: plan.state,
      toState: 'active',
      actor: cellActor(completion.cellId),
      at: completion.now,
    }),
  );
  await unlockWaitingOrders(
    tx,
    { planId: plan.planId, parentOrderId: null },
    {},
    completion,
    log,
  );
  return completedResponse(null);
};

const deliverOrder = async (
  tx: StorageWriteTx,
  order: WorkOrderRow,
  completion: Completion,
  log: TransitionLog,
): Promise<TransitionResponse> => {
  await updateWorkOrder(
    tx,
    order,
    {
      state: 'delivered',
      headCommitSha: completion.commitSha,
      activeCellId: null,
      activeJobId: null,
      pinnedFactoryId: null,
    },
    completion.now,
  );
  log.push(
    orderTransition({
      projectId: order.projectId,
      entityType: 'work_order',
      entityId: order.orderId,
      fromState: order.state,
      toState: 'delivered',
      actor: cellActor(completion.cellId),
      at: completion.now,
    }),
  );
  await unlockWaitingOrders(
    tx,
    { parentOrderId: order.orderId },
    { baseCommitSha: completion.commitSha },
    completion,
    log,
  );
  return completedResponse(null);
};

const issueJob = async (
  tx: StorageWriteTx,
  job: JobRow,
  order: WorkOrderRow,
  steps: readonly OrderStepRow[],
  next: OrderStepRow,
  input: IssueInput,
): Promise<ClaimedJob> => {
  const { cellId, now, log } = input;
  const epoch = order.epoch + 1;
  const leaseExpiresAt = addMs(now, LEASE_TTL_MS);

  await tx.steps.update(next.stepId, { state: 'claimed', updatedAt: now });
  log.push(
    orderTransition({
      projectId: job.projectId,
      entityType: 'order_step',
      entityId: next.stepId,
      fromState: next.state,
      toState: 'claimed',
      actor: cellActor(cellId),
      at: now,
    }),
  );
  const nextJob = await tx.jobs.insert({
    jobId: asJobId(`job-${crypto.randomUUID()}`),
    projectId: job.projectId,
    orderId: order.orderId,
    stepId: next.stepId,
    lineName: order.lineName,
    kind: JOB_KIND_BY_STEP_KIND[next.kind],
    workspaceMode: input.workspaceMode,
    status: 'claimed',
    repoUrl: job.repoUrl,
    baseBranch: job.baseBranch,
    baseCommitSha: job.baseCommitSha,
    targetBranch: job.targetBranch,
    expectedPriorStepsJson: steps
      .filter((prior) => prior.stepIndex < next.stepIndex)
      .map((prior) => ({
        stepId: prior.stepId,
        stationId: prior.stationId,
        stepIndex: prior.stepIndex,
        requiredFiles: prior.requiredFilesJson,
      })),
    payloadJson: stepJobPayload(order, next.stepIndex),
    claimedByCellId: cellId,
    claimedByFactoryId: job.claimedByFactoryId,
    epoch,
    leaseExpiresAt,
    createdAt: now,
    startedAt: now,
  });
  log.push(
    orderTransition({
      projectId: job.projectId,
      entityType: 'job',
      entityId: nextJob.jobId,
      fromState: null,
      toState: 'claimed',
      actor: cellActor(cellId),
      at: now,
    }),
  );

  await updateWorkOrder(
    tx,
    order,
    {
      ...input.orderPatch,
      currentStepIndex: next.stepIndex,
      activeJobId: nextJob.jobId,
      epoch,
    },
    now,
  );
  return toClaimedJob(
    nextJob,
    leaseExpiresAt,
    input.orderPatch.headCommitSha ??
      order.headCommitSha ??
      order.baseCommitSha,
  );
};

const advanceOrder = async (
  tx: StorageWriteTx,
  job: JobRow,
  order: WorkOrderRow,
  step: OrderStepRow,
  completion: Completion,
  log: TransitionLog,
): Promise<TransitionResponse> => {
  const steps = await tx.steps.listByOrder(order.orderId);
  const next = steps.find(
    (candidate) => candidate.stepIndex === step.stepIndex + 1,
  );
  if (next === undefined)
    throw new UnprocessableTransition(`no step after index ${step.stepIndex}`);
  const nextJob = await issueJob(tx, job, order, steps, next, {
    cellId: completion.cellId,
    workspaceMode: 'reuse',
    now: completion.now,
    log,
    orderPatch: { headCommitSha: completion.commitSha },
  });
  return completedResponse(nextJob);
};

const completeStep = async (
  tx: StorageWriteTx,
  job: JobRow,
  order: WorkOrderRow,
  step: OrderStepRow,
  completion: Completion,
  log: TransitionLog,
): Promise<TransitionResponse> => {
  assertArtifactsProduced(step.requiredFilesJson, completion.producedFiles);
  await finishJob(tx, job, completion, log);
  await finishStep(tx, step, completion, log);
  if (step.kind === 'deliver') return deliverOrder(tx, order, completion, log);
  return advanceOrder(tx, job, order, step, completion, log);
};

const completeJob = async (
  tx: StorageWriteTx,
  job: JobRow,
  cellId: CellId,
  input: CompleteInput,
  now: number,
  log: TransitionLog,
): Promise<TransitionResponse> => {
  requireStatus(job, 'running');
  const completion: Completion = {
    projectId: job.projectId,
    cellId,
    commitSha: requireCommitSha(input.commitSha),
    output: input.output ?? null,
    producedFiles: input.producedFiles,
    now,
  };
  if (job.kind === 'plan_branch')
    return completePlanBranch(tx, job, completion, log);
  const order = await requireOrder(tx, orderIdOf(job));
  return completeStep(
    tx,
    job,
    order,
    await boundStep(tx, job),
    completion,
    log,
  );
};

const stepWithId = (
  steps: readonly OrderStepRow[],
  stepId: string,
): OrderStepRow => {
  const step = steps.find((candidate) => candidate.stepId === stepId);
  if (step === undefined)
    throw new UnprocessableTransition(`no step with id ${stepId}`);
  return step;
};

const endJob = async (
  tx: StorageWriteTx,
  job: JobRow,
  status: 'failed' | 'blocked' | 'line_unavailable',
  cellId: CellId,
  resultJson: Record<string, unknown>,
  now: number,
  log: TransitionLog,
): Promise<void> => {
  await tx.jobs.update(job.jobId, { status, resultJson, finishedAt: now });
  log.push(
    orderTransition({
      projectId: job.projectId,
      entityType: 'job',
      entityId: job.jobId,
      fromState: job.status,
      toState: status,
      actor: cellActor(cellId),
      at: now,
    }),
  );
};

const setStepState = async (
  tx: StorageWriteTx,
  job: JobRow,
  step: OrderStepRow,
  state: OrderStepRow['state'],
  cellId: CellId,
  now: number,
  log: TransitionLog,
  patch: Partial<OrderStepInsert> = {},
): Promise<void> => {
  await tx.steps.update(step.stepId, { ...patch, state, updatedAt: now });
  if (step.state === state) return;
  log.push(
    orderTransition({
      projectId: job.projectId,
      entityType: 'order_step',
      entityId: step.stepId,
      fromState: step.state,
      toState: state,
      actor: cellActor(cellId),
      at: now,
    }),
  );
};

const blockOrder = async (
  tx: StorageWriteTx,
  job: JobRow,
  order: WorkOrderRow,
  cellId: CellId,
  action: BlockedAction,
  incident: Pick<OpenIncident, 'reason' | 'detail'> & {
    failedStepId: StepId | null;
  },
  now: number,
  log: TransitionLog,
  patch: Partial<WorkOrderInsert> = {},
): Promise<TransitionResponse> => {
  const triage = triageIncident(
    incident.reason,
    toWorkOrderSnapshot(order, await tx.steps.listByOrder(order.orderId)),
  );
  await updateWorkOrder(
    tx,
    order,
    {
      ...patch,
      mechanicRuns: triage.workOrder.mechanicRuns,
      state: 'blocked',
      activeJobId: null,
      activeCellId: null,
    },
    now,
  );
  log.push(
    orderTransition({
      projectId: order.projectId,
      entityType: 'work_order',
      entityId: order.orderId,
      fromState: order.state,
      toState: 'blocked',
      actor: cellActor(cellId),
      at: now,
    }),
  );
  const incidentId = await openIncident(
    tx,
    {
      projectId: order.projectId,
      orderId: order.orderId,
      failedStepId: incident.failedStepId,
      failedJobId: job.jobId,
      reason: incident.reason,
      detail: incident.detail,
      triage: triage.incident,
    },
    now,
  );
  if (triage.mechanicJob !== null)
    await insertMechanicJob(
      tx,
      order,
      {
        incidentId,
        factoryId: asFactoryId(triage.mechanicJob.pinnedFactoryId),
        repoUrl: (await requireProject(tx, order.projectId)).repoUrl,
        reason: incident.reason,
        detail: incident.detail,
      },
      now,
    );
  return blockedResponse(action);
};

const rewindTo = async (
  tx: StorageWriteTx,
  job: JobRow,
  cellId: CellId,
  order: WorkOrderRow,
  target: number,
  current: number,
  now: number,
  log: TransitionLog,
): Promise<ClaimedJob> => {
  for (const step of await tx.steps.listByOrder(order.orderId)) {
    if (step.stepIndex > target && step.stepIndex <= current)
      await setStepState(tx, job, step, 'pending', cellId, now, log);
  }
  const steps = await tx.steps.listByOrder(order.orderId);
  return issueJob(tx, job, order, steps, stepAt(steps, target), {
    cellId,
    workspaceMode: 'reuse',
    now,
    log,
    orderPatch: {},
  });
};

const failJob = async (
  tx: StorageWriteTx,
  job: JobRow,
  cellId: CellId,
  input: FailInput,
  now: number,
  log: TransitionLog,
): Promise<TransitionResponse> => {
  requireStatus(job, 'running');
  const order = await requireOrder(tx, orderIdOf(job));
  const step = await boundStep(tx, job);
  const failure = planStepFailure(
    toOrderSteps(await tx.steps.listByOrder(order.orderId)),
    step.stepIndex,
  );
  await endJob(
    tx,
    job,
    'failed',
    cellId,
    { detail: input.detail, output: input.output ?? null },
    now,
    log,
  );
  await setStepState(tx, job, step, 'failed', cellId, now, log, {
    attemptsUsed: failure.attemptsUsed,
  });

  const plan = failure.plan;
  if (plan.kind === 'blocked')
    return blockOrder(
      tx,
      job,
      order,
      cellId,
      'fail',
      {
        failedStepId: step.stepId,
        reason: input.workspaceFailed ? 'workspace_failed' : plan.trigger,
        detail: input.detail,
      },
      now,
      log,
    );
  const nextJob = await rewindTo(
    tx,
    job,
    cellId,
    order,
    plan.stepIndex,
    step.stepIndex,
    now,
    log,
  );
  return failedResponse(nextJob);
};

const blockJob = async (
  tx: StorageWriteTx,
  job: JobRow,
  cellId: CellId,
  input: BlockInput,
  now: number,
  log: TransitionLog,
): Promise<TransitionResponse> => {
  requireStatus(job, 'running');
  const order = await requireOrder(tx, orderIdOf(job));
  const step = await boundStep(tx, job);
  await endJob(
    tx,
    job,
    'blocked',
    cellId,
    { detail: input.detail, handoverFile: input.handoverFile ?? null },
    now,
    log,
  );
  await setStepState(tx, job, step, 'blocked', cellId, now, log);
  return blockOrder(
    tx,
    job,
    order,
    cellId,
    'block',
    {
      failedStepId: step.stepId,
      reason: 'operator_blocked',
      detail:
        input.handoverFile === undefined
          ? input.detail
          : `${input.detail} (handover: ${input.handoverFile})`,
    },
    now,
    log,
  );
};

const resetWorktree = async (
  tx: StorageWriteTx,
  job: JobRow,
  cellId: CellId,
  input: WorktreeMissingInput,
  now: number,
  log: TransitionLog,
): Promise<TransitionResponse> => {
  requireStatus(job, 'claimed', 'running');
  const order = await requireOrder(tx, orderIdOf(job));
  const missing = stepWithId(
    await tx.steps.listByOrder(order.orderId),
    input.missingStepId,
  );
  const reset = planWorktreeMissing(order.worktreeResets);
  await endJob(
    tx,
    job,
    'failed',
    cellId,
    { missingStepId: input.missingStepId, missingFiles: input.missingFiles },
    now,
    log,
  );

  if (reset.plan.kind === 'blocked')
    return blockOrder(
      tx,
      job,
      order,
      cellId,
      'worktree_missing',
      {
        failedStepId: missing.stepId,
        reason: reset.plan.trigger,
        detail: `worktree missing: ${input.missingFiles.join(', ')}`,
      },
      now,
      log,
      { worktreeResets: reset.worktreeResets },
    );

  for (const step of await tx.steps.listByOrder(order.orderId))
    await setStepState(tx, job, step, 'pending', cellId, now, log, {
      attemptsUsed: 0,
    });
  const steps = await tx.steps.listByOrder(order.orderId);
  const nextJob = await issueJob(tx, job, order, steps, stepAt(steps, 0), {
    cellId,
    workspaceMode: 'fresh',
    now,
    log,
    orderPatch: { worktreeResets: reset.worktreeResets },
  });
  return resetResponse(nextJob);
};

const hasServingFactory = async (
  tx: StorageWriteTx,
  order: WorkOrderRow,
  excludedFactoryIds: readonly FactoryId[],
  now: number,
): Promise<boolean> =>
  (await tx.factories.list()).some(
    (factory) =>
      !isSilent(factory.lastSeenAt, now) &&
      !excludedFactoryIds.includes(factory.factoryId) &&
      factory.projectsJson.some(
        (project) =>
          project.projectId === order.projectId && project.desired > 0,
      ),
  );

const factoryOf = (job: JobRow): FactoryId => {
  if (job.claimedByFactoryId === null)
    throw new Conflict(`Job ${job.jobId} has no claiming factory`);
  return job.claimedByFactoryId;
};

const lineUnavailable = async (
  tx: StorageWriteTx,
  job: JobRow,
  cellId: CellId,
  input: LineUnavailableInput,
  now: number,
  log: TransitionLog,
): Promise<TransitionResponse> => {
  if (job.status !== 'claimed' && job.status !== 'running')
    throw new Conflict(`Job ${job.jobId} cannot transition from ${job.status}`);
  const order = await requireOrder(tx, orderIdOf(job));
  const unavailableLineFactories = [
    ...order.unavailableLineFactoriesJson.map((id) => asFactoryId(id)),
    factoryOf(job),
  ];
  const servable = await hasServingFactory(
    tx,
    order,
    unavailableLineFactories,
    now,
  );
  const state = servable ? 'queued' : 'line_unavailable';

  await endJob(
    tx,
    job,
    'line_unavailable',
    cellId,
    { lineName: input.lineName, detail: input.detail },
    now,
    log,
  );
  if (job.stepId !== null)
    await setStepState(
      tx,
      job,
      await boundStep(tx, job),
      'pending',
      cellId,
      now,
      log,
    );
  await updateWorkOrder(
    tx,
    order,
    {
      state,
      unavailableLineFactoriesJson: unavailableLineFactories,
      activeJobId: null,
      activeCellId: null,
      pinnedFactoryId: null,
    },
    now,
  );
  log.push(
    orderTransition({
      projectId: order.projectId,
      entityType: 'work_order',
      entityId: order.orderId,
      fromState: order.state,
      toState: state,
      actor: cellActor(cellId),
      at: now,
    }),
  );
  if (!servable)
    await openIncident(
      tx,
      {
        projectId: order.projectId,
        orderId: order.orderId,
        failedStepId: job.stepId,
        failedJobId: job.jobId,
        reason: 'line_unavailable',
        detail: input.detail,
        triage: triageIncident(
          'line_unavailable',
          toWorkOrderSnapshot(order, await tx.steps.listByOrder(order.orderId)),
        ).incident,
      },
      now,
    );
  return lineUnavailableResponse(null);
};

const dispatch = (
  tx: StorageWriteTx,
  job: JobRow,
  cellId: CellId,
  body: TransitionBody,
  now: number,
  log: TransitionLog,
): Promise<TransitionResponse> => {
  switch (body.action) {
    case 'line_unavailable':
      return lineUnavailable(tx, job, cellId, body, now, log);
    case 'start':
      return startJob(tx, job, cellId, body, now, log);
    case 'complete':
      return completeJob(tx, job, cellId, body, now, log);
    case 'fail':
      return failJob(tx, job, cellId, body, now, log);
    case 'block':
      return blockJob(tx, job, cellId, body, now, log);
    case 'worktree_missing':
      return resetWorktree(tx, job, cellId, body, now, log);
  }
};

export const transitionJobProcedure = scopedProcedure(['factory:worker'])(
  transitionJobContract,
)(async (input, ctx) => {
  const cellId = cellIdOf(ctx);
  const factoryId = factoryIdOf(ctx);
  const now = ctx.clock.now();
  const commandId = asCommandId(input.body.commandId);

  const outcome = await settle(() =>
    ctx.storage.write(async (tx) => {
      await touchFactory(tx, factoryId, now);
      const job = await requireJob(tx, input.params.id);
      const replay = await findReplay(tx, commandId, job.jobId);
      if (replay !== undefined) return { response: replay, records: [] };
      fence(job, cellId, input.body.epoch);
      const log: TransitionLog = [];
      const response = await dispatch(tx, job, cellId, input.body, now, log);
      return {
        response,
        records: await flushTransitions(tx, log, {
          actorLabel: ctx.principal.name,
          command: { commandId, meta: { result: response } },
        }),
      };
    }),
  );
  publishCommitted(ctx, outcome.records);
  return outcome.response;
});
