import { and, asc, eq, isNull, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import { LEASE_TTL_MS } from '../../../config';
import { immediateTx, type DbTx } from '../../../db/client';
import { cells } from '../../../db/schema/cells';
import { jobs } from '../../../db/schema/jobs';
import { orderSteps, workOrders } from '../../../db/schema/orders';
import { orderPlans } from '../../../db/schema/plans';
import { stateTransitions } from '../../../db/schema/transitions';
import { transitionJobContract } from '../../../contracts/jobs.contract';
import {
  asCellId,
  asCommandId,
  asJobId,
  asStepId,
  type CellId,
  type CommandId,
  type OrderId,
  type ProjectId,
  type StepId,
} from '../../../domain/common/brand';
import { addMs } from '../../../domain/common/time';
import { allowsLine } from '../../../domain/cells/claim-eligibility';
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
  Forbidden,
  InternalServer,
  NotFound,
  StaleLeaseEpoch,
} from '../../core/error-handling';
import { scopedProcedure } from '../../core/procedure';
import {
  flushTransitions,
  orderTransition,
  publishCommitted,
  releaseCell,
  requireOrder,
  requirePlan,
  requireProject,
  settle,
  updateWorkOrder,
  type Actor,
  type TransitionLog,
  type WorkOrderInsert,
} from '../../orders/order-writes';
import {
  insertMechanicJob,
  openIncident,
  toOrderSteps,
  toWorkOrderSnapshot,
  type OpenIncident,
} from '../../orders/incident-writes';
import { claimNext, toClaimedJob } from '../cells/claim-job.procedure';

const JOB_KIND_BY_STEP_KIND = {
  operator: 'run_operator',
  inspection: 'run_inspection',
  deliver: 'deliver',
} as const;
const SERVING_CELL_STATUSES = ['online', 'busy', 'draining'] as const;

type JobRow = typeof jobs.$inferSelect;
type StepRow = typeof orderSteps.$inferSelect;
type StepInsert = typeof orderSteps.$inferInsert;
type WorkOrderRow = typeof workOrders.$inferSelect;
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

const requireJob = (tx: DbTx, jobId: string): JobRow => {
  const row = tx
    .select()
    .from(jobs)
    .where(eq(jobs.jobId, asJobId(jobId)))
    .get();
  if (row === undefined) throw new NotFound(`Job ${jobId} not found`);
  return row;
};

const findReplay = (
  tx: DbTx,
  commandId: CommandId,
  jobId: string,
): TransitionResponse | undefined => {
  const prior = tx
    .select()
    .from(stateTransitions)
    .where(eq(stateTransitions.commandId, commandId))
    .get();
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
  if (job.cellId !== cellId || job.epoch !== epoch)
    throw new StaleLeaseEpoch(`Job ${job.jobId} epoch ${epoch} is stale`);
};

const requireStatus = (job: JobRow, status: JobRow['status']): void => {
  if (job.status !== status)
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

const stepsOf = (tx: DbTx, orderId: OrderId): StepRow[] =>
  tx
    .select()
    .from(orderSteps)
    .where(eq(orderSteps.orderId, orderId))
    .orderBy(asc(orderSteps.stepIndex))
    .all();

const stepAt = (steps: readonly StepRow[], stepIndex: number): StepRow => {
  const step = steps.find((candidate) => candidate.stepIndex === stepIndex);
  if (step === undefined)
    throw new UnprocessableTransition(`no step at index ${stepIndex}`);
  return step;
};

const boundStep = (tx: DbTx, job: JobRow): StepRow => {
  if (job.stepId === null)
    throw new Conflict(`Job ${job.jobId} has no bound step`);
  const row = tx
    .select()
    .from(orderSteps)
    .where(eq(orderSteps.stepId, job.stepId))
    .get();
  if (row === undefined) throw new NotFound(`Step ${job.stepId} not found`);
  return row;
};

const insertSteps = (
  tx: DbTx,
  orderId: OrderId,
  steps: readonly OrderStep[],
  now: number,
): void => {
  tx.insert(orderSteps)
    .values(
      steps.map((step): StepInsert => ({
        stepId: asStepId(`step-${crypto.randomUUID()}`),
        orderId,
        stepIndex: step.stepIndex,
        stationId: step.stationId,
        kind: step.kind,
        runner: null,
        configJson: {},
        requiredFilesJson: step.requiredFiles,
        producedFilesJson: [],
        state: 'pending',
        attemptsUsed: 0,
        maxAttempts: step.maxAttempts,
        onFailRetryStationId: step.onFailRetryStationId,
        updatedAt: now,
      })),
    )
    .run();
};

const finishJob = (
  tx: DbTx,
  job: JobRow,
  completion: Completion,
  log: TransitionLog,
): void => {
  tx.update(jobs)
    .set({
      status: 'passed',
      resultCommitSha: completion.commitSha,
      resultJson: completion.output,
      finishedAt: completion.now,
    })
    .where(eq(jobs.jobId, job.jobId))
    .run();
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

const finishStep = (
  tx: DbTx,
  step: StepRow,
  completion: Completion,
  log: TransitionLog,
): void => {
  tx.update(orderSteps)
    .set({
      state: 'passed',
      producedFilesJson: completion.producedFiles,
      lastCommitSha: completion.commitSha,
      lastOutputJson: completion.output,
      updatedAt: completion.now,
    })
    .where(eq(orderSteps.stepId, step.stepId))
    .run();
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

const unlockWaitingOrders = (
  tx: DbTx,
  condition: SQL | undefined,
  patch: Partial<WorkOrderInsert>,
  completion: Completion,
  log: TransitionLog,
): void => {
  const rows = tx
    .select()
    .from(workOrders)
    .where(and(condition, eq(workOrders.state, 'waiting_parent')))
    .all();
  for (const row of rows) {
    updateWorkOrder(tx, row, { ...patch, state: 'queued' }, completion.now);
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

const startJob = (
  tx: DbTx,
  job: JobRow,
  cellId: CellId,
  body: StartInput,
  now: number,
  log: TransitionLog,
): TransitionResponse => {
  requireStatus(job, 'claimed');
  const actor = cellActor(cellId);
  if (job.kind === 'plan_branch' || job.kind === 'mechanic') {
    tx.update(jobs)
      .set({ status: 'running' })
      .where(eq(jobs.jobId, job.jobId))
      .run();
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

  const order = requireOrder(tx, orderIdOf(job));
  let steps = stepsOf(tx, order.orderId);
  if (steps.length === 0 && order.currentStepIndex === 0) {
    insertSteps(
      tx,
      order.orderId,
      materializeLineSnapshot(body.lineSnapshot),
      now,
    );
    steps = stepsOf(tx, order.orderId);
  }
  const step = stepAt(steps, order.currentStepIndex);

  tx.update(jobs)
    .set({ status: 'running', stepId: step.stepId })
    .where(eq(jobs.jobId, job.jobId))
    .run();
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
  tx.update(orderSteps)
    .set({ state: 'running', updatedAt: now })
    .where(eq(orderSteps.stepId, step.stepId))
    .run();
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

const completePlanBranch = (
  tx: DbTx,
  job: JobRow,
  completion: Completion,
  log: TransitionLog,
): TransitionResponse => {
  if (job.planId === null)
    throw new Conflict(`Job ${job.jobId} has no order plan`);
  const plan = requirePlan(tx, job.planId);
  finishJob(tx, job, completion, log);
  releaseCell(tx, completion.cellId);
  tx.update(orderPlans)
    .set({
      state: 'active',
      branchCommitSha: completion.commitSha,
      version: plan.version + 1,
      updatedAt: completion.now,
    })
    .where(eq(orderPlans.planId, plan.planId))
    .run();
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
  unlockWaitingOrders(
    tx,
    and(eq(workOrders.planId, plan.planId), isNull(workOrders.parentOrderId)),
    {},
    completion,
    log,
  );
  return completedResponse(null);
};

const deliverOrder = (
  tx: DbTx,
  order: WorkOrderRow,
  completion: Completion,
  log: TransitionLog,
): TransitionResponse => {
  updateWorkOrder(
    tx,
    order,
    {
      state: 'delivered',
      headCommitSha: completion.commitSha,
      activeCellId: null,
      activeJobId: null,
      pinnedCellId: null,
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
  unlockWaitingOrders(
    tx,
    eq(workOrders.parentOrderId, order.orderId),
    { baseCommitSha: completion.commitSha },
    completion,
    log,
  );
  releaseCell(tx, completion.cellId);
  return completedResponse(null);
};

const issueJob = (
  tx: DbTx,
  job: JobRow,
  order: WorkOrderRow,
  steps: readonly StepRow[],
  next: StepRow,
  input: IssueInput,
): ClaimedJob => {
  const { cellId, now, log } = input;
  const epoch = order.epoch + 1;
  const leaseExpiresAt = addMs(now, LEASE_TTL_MS);

  tx.update(orderSteps)
    .set({ state: 'claimed', updatedAt: now })
    .where(eq(orderSteps.stepId, next.stepId))
    .run();
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
  const nextJob = tx
    .insert(jobs)
    .values({
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
      cellId,
      epoch,
      leaseExpiresAt,
      createdAt: now,
      startedAt: now,
    })
    .returning()
    .get();
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

  updateWorkOrder(
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
  tx.update(cells)
    .set({ activeJobId: nextJob.jobId })
    .where(eq(cells.cellId, cellId))
    .run();
  return toClaimedJob(nextJob, leaseExpiresAt);
};

const advanceOrder = (
  tx: DbTx,
  job: JobRow,
  order: WorkOrderRow,
  step: StepRow,
  completion: Completion,
  log: TransitionLog,
): TransitionResponse => {
  const steps = stepsOf(tx, order.orderId);
  const next = steps.find(
    (candidate) => candidate.stepIndex === step.stepIndex + 1,
  );
  if (next === undefined)
    throw new UnprocessableTransition(`no step after index ${step.stepIndex}`);
  const nextJob = issueJob(tx, job, order, steps, next, {
    cellId: completion.cellId,
    workspaceMode: 'reuse',
    now: completion.now,
    log,
    orderPatch: { headCommitSha: completion.commitSha },
  });
  return completedResponse(nextJob);
};

const completeStep = (
  tx: DbTx,
  job: JobRow,
  order: WorkOrderRow,
  step: StepRow,
  completion: Completion,
  log: TransitionLog,
): TransitionResponse => {
  assertArtifactsProduced(step.requiredFilesJson, completion.producedFiles);
  finishJob(tx, job, completion, log);
  finishStep(tx, step, completion, log);
  if (step.kind === 'deliver') return deliverOrder(tx, order, completion, log);
  return advanceOrder(tx, job, order, step, completion, log);
};

const completeJob = (
  tx: DbTx,
  job: JobRow,
  cellId: CellId,
  input: CompleteInput,
  now: number,
  log: TransitionLog,
): TransitionResponse => {
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
  const order = requireOrder(tx, orderIdOf(job));
  return completeStep(tx, job, order, boundStep(tx, job), completion, log);
};

const stepWithId = (steps: readonly StepRow[], stepId: string): StepRow => {
  const step = steps.find((candidate) => candidate.stepId === stepId);
  if (step === undefined)
    throw new UnprocessableTransition(`no step with id ${stepId}`);
  return step;
};

const endJob = (
  tx: DbTx,
  job: JobRow,
  status: 'failed' | 'blocked' | 'line_unavailable',
  cellId: CellId,
  resultJson: Record<string, unknown>,
  now: number,
  log: TransitionLog,
): void => {
  tx.update(jobs)
    .set({ status, resultJson, finishedAt: now })
    .where(eq(jobs.jobId, job.jobId))
    .run();
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

const setStepState = (
  tx: DbTx,
  job: JobRow,
  step: StepRow,
  state: StepRow['state'],
  cellId: CellId,
  now: number,
  log: TransitionLog,
  patch: Partial<StepInsert> = {},
): void => {
  tx.update(orderSteps)
    .set({ ...patch, state, updatedAt: now })
    .where(eq(orderSteps.stepId, step.stepId))
    .run();
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

const blockOrder = (
  tx: DbTx,
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
): TransitionResponse => {
  const triage = triageIncident(
    incident.reason,
    toWorkOrderSnapshot(order, stepsOf(tx, order.orderId)),
  );
  updateWorkOrder(
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
  releaseCell(tx, cellId);
  const incidentId = openIncident(
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
    insertMechanicJob(
      tx,
      order,
      {
        incidentId,
        cellId: asCellId(triage.mechanicJob.pinnedCellId),
        repoUrl: requireProject(tx, order.projectId).repoUrl,
        reason: incident.reason,
        detail: incident.detail,
      },
      now,
    );
  return blockedResponse(action);
};

const rewindTo = (
  tx: DbTx,
  job: JobRow,
  cellId: CellId,
  order: WorkOrderRow,
  target: number,
  current: number,
  now: number,
  log: TransitionLog,
): ClaimedJob => {
  for (const step of stepsOf(tx, order.orderId)) {
    if (step.stepIndex > target && step.stepIndex <= current)
      setStepState(tx, job, step, 'pending', cellId, now, log);
  }
  const steps = stepsOf(tx, order.orderId);
  return issueJob(tx, job, order, steps, stepAt(steps, target), {
    cellId,
    workspaceMode: 'reuse',
    now,
    log,
    orderPatch: {},
  });
};

const failJob = (
  tx: DbTx,
  job: JobRow,
  cellId: CellId,
  input: FailInput,
  now: number,
  log: TransitionLog,
): TransitionResponse => {
  requireStatus(job, 'running');
  const order = requireOrder(tx, orderIdOf(job));
  const step = boundStep(tx, job);
  const failure = planStepFailure(
    toOrderSteps(stepsOf(tx, order.orderId)),
    step.stepIndex,
  );
  endJob(
    tx,
    job,
    'failed',
    cellId,
    { detail: input.detail, output: input.output ?? null },
    now,
    log,
  );
  setStepState(tx, job, step, 'failed', cellId, now, log, {
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
  const nextJob = rewindTo(
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

const blockJob = (
  tx: DbTx,
  job: JobRow,
  cellId: CellId,
  input: BlockInput,
  now: number,
  log: TransitionLog,
): TransitionResponse => {
  requireStatus(job, 'running');
  const order = requireOrder(tx, orderIdOf(job));
  const step = boundStep(tx, job);
  endJob(
    tx,
    job,
    'blocked',
    cellId,
    { detail: input.detail, handoverFile: input.handoverFile ?? null },
    now,
    log,
  );
  setStepState(tx, job, step, 'blocked', cellId, now, log);
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

const resetWorktree = (
  tx: DbTx,
  job: JobRow,
  cellId: CellId,
  input: WorktreeMissingInput,
  now: number,
  log: TransitionLog,
): TransitionResponse => {
  requireStatus(job, 'running');
  const order = requireOrder(tx, orderIdOf(job));
  const missing = stepWithId(stepsOf(tx, order.orderId), input.missingStepId);
  const reset = planWorktreeMissing(order.worktreeResets);
  endJob(
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

  for (const step of stepsOf(tx, order.orderId))
    setStepState(tx, job, step, 'pending', cellId, now, log, {
      attemptsUsed: 0,
    });
  const steps = stepsOf(tx, order.orderId);
  const nextJob = issueJob(tx, job, order, steps, stepAt(steps, 0), {
    cellId,
    workspaceMode: 'fresh',
    now,
    log,
    orderPatch: { worktreeResets: reset.worktreeResets },
  });
  return resetResponse(nextJob);
};

const hasServingCell = (
  tx: DbTx,
  order: WorkOrderRow,
  excludedCellIds: readonly string[],
): boolean =>
  tx
    .select()
    .from(cells)
    .where(eq(cells.projectId, order.projectId))
    .all()
    .some(
      (cell) =>
        SERVING_CELL_STATUSES.some((status) => status === cell.status) &&
        !excludedCellIds.includes(cell.cellId) &&
        allowsLine(cell.allowedLinesJson, order.lineName),
    );

const claimNextFor = (
  tx: DbTx,
  cellId: CellId,
  now: number,
  log: TransitionLog,
): ClaimedJob | null => {
  const cell = tx.select().from(cells).where(eq(cells.cellId, cellId)).get();
  if (cell === undefined) throw new NotFound(`Cell ${cellId} not found`);
  const leaseExpiresAt = addMs(now, LEASE_TTL_MS);
  const claimed = claimNext(tx, cell, leaseExpiresAt, now, log);
  return claimed === undefined ? null : toClaimedJob(claimed, leaseExpiresAt);
};

const lineUnavailable = (
  tx: DbTx,
  job: JobRow,
  cellId: CellId,
  input: LineUnavailableInput,
  now: number,
  log: TransitionLog,
): TransitionResponse => {
  if (job.status !== 'claimed' && job.status !== 'running')
    throw new Conflict(`Job ${job.jobId} cannot transition from ${job.status}`);
  const order = requireOrder(tx, orderIdOf(job));
  const unavailableLineCells = [...order.unavailableLineCellsJson, cellId];
  const servable = hasServingCell(tx, order, unavailableLineCells);
  const state = servable ? 'queued' : 'line_unavailable';

  endJob(
    tx,
    job,
    'line_unavailable',
    cellId,
    { lineName: input.lineName, detail: input.detail },
    now,
    log,
  );
  if (job.stepId !== null)
    setStepState(tx, job, boundStep(tx, job), 'pending', cellId, now, log);
  releaseCell(tx, cellId);
  updateWorkOrder(
    tx,
    order,
    {
      state,
      unavailableLineCellsJson: unavailableLineCells,
      activeJobId: null,
      activeCellId: null,
      pinnedCellId: null,
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
    openIncident(
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
          toWorkOrderSnapshot(order, stepsOf(tx, order.orderId)),
        ).incident,
      },
      now,
    );
  return lineUnavailableResponse(claimNextFor(tx, cellId, now, log));
};

const dispatch = (
  tx: DbTx,
  job: JobRow,
  cellId: CellId,
  body: TransitionBody,
  now: number,
  log: TransitionLog,
): TransitionResponse => {
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

export const transitionJobProcedure = scopedProcedure(['cell:worker'])(
  transitionJobContract,
)((input, ctx) => {
  const cellId = ctx.principal.cellId;
  if (cellId === null) throw new Forbidden('Token is not bound to a cell');
  const now = ctx.clock.now();
  const commandId = asCommandId(input.body.commandId);

  const outcome = settle(() =>
    immediateTx(ctx.db, (tx) => {
      const job = requireJob(tx, input.params.id);
      const replay = findReplay(tx, commandId, job.jobId);
      if (replay !== undefined) return { response: replay, records: [] };
      fence(job, cellId, input.body.epoch);
      const log: TransitionLog = [];
      const response = dispatch(tx, job, cellId, input.body, now, log);
      return {
        response,
        records: flushTransitions(tx, log, {
          commandId,
          meta: { result: response },
        }),
      };
    }),
  );
  publishCommitted(ctx, outcome.records);
  return outcome.response;
});
