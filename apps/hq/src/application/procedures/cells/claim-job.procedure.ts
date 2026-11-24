import { CLAIM_WAIT_MS, LEASE_TTL_MS } from '../../../config';
import { claimJobContract } from '@repo/hq-contracts/cells.contract';
import {
  selectClaimable,
  type ClaimCandidate,
  type ClaimCell,
} from '../../../domain/cells/claim-eligibility';
import {
  asFactoryId,
  asJobId,
  asProjectId,
  type FactoryId,
} from '../../../domain/common/brand';
import { addMs } from '../../../domain/common/time';
import { stepJobPayload } from '../../orders/job-payload';
import {
  cellIdOf,
  factoryIdOf,
  isSilent,
  touchFactory,
} from '../../core/identity';
import {
  scopedProcedure,
  type AuthenticatedContext,
} from '../../core/procedure';
import type {
  JobRow,
  ProjectRow,
  StorageWriteTx,
  WorkOrderRow,
} from '../../ports/storage.port';
import {
  findPlan,
  flushTransitions,
  orderTransition,
  publishCommitted,
  requireProject,
  updateWorkOrder,
  type TransitionLog,
} from '../../orders/order-writes';
import { reapExpiredLeases } from './reap-expired-leases';

const unreachableFactoryIds = (
  tx: StorageWriteTx,
  now: number,
): Set<FactoryId> =>
  new Set(
    tx.factories
      .list()
      .filter((row) => isSilent(row.lastSeenAt, now))
      .map((row) => row.factoryId),
  );

const bindJob = (
  cell: ClaimCell,
  epoch: number,
  leaseExpiresAt: number,
  now: number,
) => ({
  status: 'claimed' as const,
  claimedByCellId: cell.cellId,
  claimedByFactoryId: cell.factoryId,
  epoch,
  leaseExpiresAt,
  startedAt: now,
});

const claimPlanBranch = (
  tx: StorageWriteTx,
  cell: ClaimCell,
  leaseExpiresAt: number,
  now: number,
): JobRow | undefined => {
  for (const job of tx.jobs.listReadyPlanBranches(cell.projectId)) {
    const plan = job.planId === null ? undefined : findPlan(tx, job.planId);
    if (plan?.state !== 'branching') continue;
    return tx.jobs.update(
      job.jobId,
      bindJob(cell, job.epoch + 1, leaseExpiresAt, now),
    );
  }
  return undefined;
};

const claimMechanicJob = (
  tx: StorageWriteTx,
  cell: ClaimCell,
  leaseExpiresAt: number,
  now: number,
): JobRow | undefined => {
  const job = tx.jobs.findReadyMechanic(cell.factoryId);
  if (job === undefined) return undefined;
  return tx.jobs.update(
    job.jobId,
    bindJob(cell, job.epoch + 1, leaseExpiresAt, now),
  );
};

const toClaimCandidate = (
  row: WorkOrderRow,
  unreachable: ReadonlySet<FactoryId>,
): ClaimCandidate => ({
  orderId: row.orderId,
  projectId: row.projectId,
  state: row.state,
  priority: row.priority,
  lineName: row.lineName,
  createdAt: row.createdAt,
  pinnedFactoryId: row.pinnedFactoryId,
  pinnedFactoryUnavailable:
    row.pinnedFactoryId !== null && unreachable.has(row.pinnedFactoryId),
  activeCellId: row.activeCellId,
  activeJobId: row.activeJobId === null ? null : asJobId(row.activeJobId),
  unavailableLineFactories: row.unavailableLineFactoriesJson.map((id) =>
    asFactoryId(id),
  ),
});

const resumeReadyJob = (
  tx: StorageWriteTx,
  row: WorkOrderRow,
  stepId: string | null,
  cell: ClaimCell,
  leaseExpiresAt: number,
  now: number,
): JobRow | undefined => {
  const job = tx.jobs.findReadyRunOperator(row.orderId);
  if (job === undefined || job.stepId !== stepId) return undefined;
  return tx.jobs.update(
    job.jobId,
    bindJob(cell, job.epoch + 1, leaseExpiresAt, now),
  );
};

const claimWorkOrder = (
  tx: StorageWriteTx,
  cell: ClaimCell,
  project: ProjectRow,
  leaseExpiresAt: number,
  now: number,
  log: TransitionLog,
): JobRow | undefined => {
  const rows = tx.orders.listQueued(cell.projectId);
  const unreachable = unreachableFactoryIds(tx, now);
  const runningCount = tx.orders.list({
    projectId: cell.projectId,
    state: 'running',
  }).length;
  const [picked] = selectClaimable(
    rows.map((row) => toClaimCandidate(row, unreachable)),
    cell,
    { runningCount, maxRunning: project.maxRunning },
  );
  if (picked === undefined) return undefined;
  const row = rows.find((candidate) => candidate.orderId === picked.orderId);
  if (row === undefined) return undefined;

  const steps = tx.steps.listByOrder(row.orderId);
  const currentStep = steps.find(
    (step) => step.stepIndex === row.currentStepIndex,
  );
  const epoch = row.epoch + 1;
  const job =
    resumeReadyJob(
      tx,
      row,
      currentStep?.stepId ?? null,
      cell,
      leaseExpiresAt,
      now,
    ) ??
    tx.jobs.insert({
      jobId: asJobId(`job-${crypto.randomUUID()}`),
      projectId: row.projectId,
      orderId: row.orderId,
      stepId: currentStep?.stepId ?? null,
      lineName: row.lineName,
      kind: 'run_operator',
      workspaceMode:
        row.currentStepIndex === 0 && row.worktreeResets === 0
          ? 'fresh'
          : 'reuse',
      status: 'claimed',
      repoUrl: project.repoUrl,
      baseBranch: row.baseBranch,
      baseCommitSha: row.baseCommitSha,
      targetBranch: row.branch,
      expectedPriorStepsJson: steps
        .filter((step) => step.stepIndex < row.currentStepIndex)
        .map((step) => ({
          stepId: step.stepId,
          stationId: step.stationId,
          stepIndex: step.stepIndex,
          requiredFiles: step.requiredFilesJson,
        })),
      payloadJson: stepJobPayload(row, row.currentStepIndex),
      claimedByCellId: cell.cellId,
      claimedByFactoryId: cell.factoryId,
      epoch,
      leaseExpiresAt,
      createdAt: now,
      startedAt: now,
    });
  updateWorkOrder(
    tx,
    row,
    {
      state: 'running',
      activeCellId: cell.cellId,
      activeJobId: job.jobId,
      pinnedFactoryId: cell.factoryId,
      epoch: job.epoch,
    },
    now,
  );
  log.push(
    orderTransition({
      projectId: row.projectId,
      entityType: 'work_order',
      entityId: row.orderId,
      fromState: row.state,
      toState: 'running',
      actor: { kind: 'cell', id: cell.cellId },
      at: now,
    }),
  );
  return job;
};

const claimNext = (
  tx: StorageWriteTx,
  cell: ClaimCell,
  leaseExpiresAt: number,
  now: number,
  log: TransitionLog,
): JobRow | undefined => {
  const plan = claimPlanBranch(tx, cell, leaseExpiresAt, now);
  if (plan !== undefined) return plan;
  const mechanic = claimMechanicJob(tx, cell, leaseExpiresAt, now);
  if (mechanic !== undefined) return mechanic;
  const project = requireProject(tx, cell.projectId);
  return claimWorkOrder(tx, cell, project, leaseExpiresAt, now, log);
};

export const headCommitOfJob = (
  tx: StorageWriteTx,
  job: JobRow,
): string | null => {
  if (job.orderId === null) return null;
  const order = tx.orders.find(job.orderId);
  return order?.headCommitSha ?? order?.baseCommitSha ?? null;
};

export const toClaimedJob = (
  row: JobRow,
  leaseExpiresAt: number,
  headCommitSha: string | null,
) => ({
  jobId: row.jobId,
  kind: row.kind,
  orderId: row.orderId,
  planId: row.planId,
  stepId: row.stepId,
  workspaceMode: row.workspaceMode,
  epoch: row.epoch,
  leaseExpiresAt,
  repoUrl: row.repoUrl,
  baseBranch: row.baseBranch,
  baseCommitSha: row.baseCommitSha,
  headCommitSha,
  targetBranch: row.targetBranch,
  expectedPriorSteps: row.expectedPriorStepsJson,
  incidentId: row.incidentId,
  payload: row.payloadJson,
});

const attemptClaim = async (ctx: AuthenticatedContext, cell: ClaimCell) => {
  const now = ctx.clock.now();
  const leaseExpiresAt = addMs(now, LEASE_TTL_MS);
  const outcome = await ctx.storage.write((tx) => {
    const log: TransitionLog = [];
    touchFactory(tx, cell.factoryId, now);
    reapExpiredLeases(tx, now, log);
    const claimed =
      tx.jobs.findActiveByCell(cell.cellId) !== undefined
        ? undefined
        : claimNext(tx, cell, leaseExpiresAt, now, log);
    return {
      job:
        claimed === undefined
          ? null
          : toClaimedJob(claimed, leaseExpiresAt, headCommitOfJob(tx, claimed)),
      records: flushTransitions(tx, log),
    };
  });
  publishCommitted(ctx, outcome.records);
  return outcome;
};

export const claimJobProcedure = scopedProcedure(['factory:worker'])(
  claimJobContract,
)(async (input, ctx) => {
  const cell: ClaimCell = {
    cellId: cellIdOf(ctx),
    factoryId: factoryIdOf(ctx),
    projectId: asProjectId(input.body.projectId),
    allowedLines: input.body.allowedLines,
  };
  const waitMs = Math.min(input.body.waitMs, CLAIM_WAIT_MS);
  const first = await attemptClaim(ctx, cell);
  if (first.job !== null || waitMs === 0)
    return { code: 200 as const, job: first.job };
  await ctx.claimWaiters.waitForWake(waitMs, ctx.signal);
  const second = await attemptClaim(ctx, cell);
  return { code: 200 as const, job: second.job };
});
