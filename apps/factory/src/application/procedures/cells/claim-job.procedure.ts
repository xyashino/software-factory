import { and, asc, eq, inArray } from 'drizzle-orm';
import { CLAIM_WAIT_MS, LEASE_TTL_MS } from '../../../config';
import { immediateTx, type DbTx } from '../../../db/client';
import { factories } from '../../../db/schema/factories';
import { jobs } from '../../../db/schema/jobs';
import { orderSteps, workOrders } from '../../../db/schema/orders';
import { projects } from '../../../db/schema/projects';
import { claimJobContract } from '@repo/factory-contracts/cells.contract';
import {
  selectClaimable,
  type ClaimCandidate,
  type ClaimCell,
} from '../../../domain/cells/claim-eligibility';
import {
  asFactoryId,
  asJobId,
  asProjectId,
  type CellId,
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

const ACTIVE_JOB_STATUSES = ['claimed', 'running'] as const;

type JobRow = typeof jobs.$inferSelect;
type WorkOrderRow = typeof workOrders.$inferSelect;
type ProjectRow = typeof projects.$inferSelect;

const holdsActiveJob = (tx: DbTx, cellId: CellId): boolean =>
  tx
    .select({ jobId: jobs.jobId })
    .from(jobs)
    .where(
      and(
        eq(jobs.claimedByCellId, cellId),
        inArray(jobs.status, ACTIVE_JOB_STATUSES),
      ),
    )
    .get() !== undefined;

const unreachableFactoryIds = (tx: DbTx, now: number): Set<FactoryId> =>
  new Set(
    tx
      .select({
        factoryId: factories.factoryId,
        lastSeenAt: factories.lastSeenAt,
      })
      .from(factories)
      .all()
      .filter((row) => isSilent(row.lastSeenAt, now))
      .map((row) => asFactoryId(row.factoryId)),
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
  tx: DbTx,
  cell: ClaimCell,
  leaseExpiresAt: number,
  now: number,
): JobRow | undefined => {
  const readyJobs = tx
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.projectId, cell.projectId),
        eq(jobs.kind, 'plan_branch'),
        eq(jobs.status, 'ready'),
      ),
    )
    .orderBy(asc(jobs.createdAt), asc(jobs.jobId))
    .all();
  for (const job of readyJobs) {
    const plan = job.planId === null ? undefined : findPlan(tx, job.planId);
    if (plan?.state !== 'branching') continue;
    return tx
      .update(jobs)
      .set(bindJob(cell, job.epoch + 1, leaseExpiresAt, now))
      .where(eq(jobs.jobId, job.jobId))
      .returning()
      .get();
  }
  return undefined;
};

const claimMechanicJob = (
  tx: DbTx,
  cell: ClaimCell,
  leaseExpiresAt: number,
  now: number,
): JobRow | undefined => {
  const job = tx
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.kind, 'mechanic'),
        eq(jobs.status, 'ready'),
        eq(jobs.claimedByFactoryId, cell.factoryId),
      ),
    )
    .orderBy(asc(jobs.createdAt), asc(jobs.jobId))
    .get();
  if (job === undefined) return undefined;
  return tx
    .update(jobs)
    .set(bindJob(cell, job.epoch + 1, leaseExpiresAt, now))
    .where(eq(jobs.jobId, job.jobId))
    .returning()
    .get();
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
  tx: DbTx,
  row: WorkOrderRow,
  stepId: string | null,
  cell: ClaimCell,
  leaseExpiresAt: number,
  now: number,
): JobRow | undefined => {
  const job = tx
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.orderId, row.orderId),
        eq(jobs.kind, 'run_operator'),
        eq(jobs.status, 'ready'),
      ),
    )
    .get();
  if (job === undefined || job.stepId !== stepId) return undefined;
  return tx
    .update(jobs)
    .set(bindJob(cell, job.epoch + 1, leaseExpiresAt, now))
    .where(eq(jobs.jobId, job.jobId))
    .returning()
    .get();
};

const claimWorkOrder = (
  tx: DbTx,
  cell: ClaimCell,
  project: ProjectRow,
  leaseExpiresAt: number,
  now: number,
  log: TransitionLog,
): JobRow | undefined => {
  const rows = tx
    .select()
    .from(workOrders)
    .where(
      and(
        eq(workOrders.projectId, cell.projectId),
        eq(workOrders.state, 'queued'),
      ),
    )
    .orderBy(asc(workOrders.createdAt), asc(workOrders.orderId))
    .all();
  const unreachable = unreachableFactoryIds(tx, now);
  const runningCount = tx
    .select()
    .from(workOrders)
    .where(
      and(
        eq(workOrders.projectId, cell.projectId),
        eq(workOrders.state, 'running'),
      ),
    )
    .all().length;
  const [picked] = selectClaimable(
    rows.map((row) => toClaimCandidate(row, unreachable)),
    cell,
    { runningCount, maxRunning: project.maxRunning },
  );
  if (picked === undefined) return undefined;
  const row = rows.find((candidate) => candidate.orderId === picked.orderId);
  if (row === undefined) return undefined;

  const steps = tx
    .select()
    .from(orderSteps)
    .where(eq(orderSteps.orderId, row.orderId))
    .orderBy(asc(orderSteps.stepIndex))
    .all();
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
    tx
      .insert(jobs)
      .values({
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
      })
      .returning()
      .get();
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
  tx: DbTx,
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

export const toClaimedJob = (row: JobRow, leaseExpiresAt: number) => ({
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
  targetBranch: row.targetBranch,
  expectedPriorSteps: row.expectedPriorStepsJson,
  incidentId: row.incidentId,
  payload: row.payloadJson,
});

const attemptClaim = (ctx: AuthenticatedContext, cell: ClaimCell) => {
  const now = ctx.clock.now();
  const leaseExpiresAt = addMs(now, LEASE_TTL_MS);
  const outcome = immediateTx(ctx.db, (tx) => {
    const log: TransitionLog = [];
    touchFactory(tx, cell.factoryId, now);
    reapExpiredLeases(tx, now, log);
    const claimed = holdsActiveJob(tx, cell.cellId)
      ? undefined
      : claimNext(tx, cell, leaseExpiresAt, now, log);
    return {
      job: claimed === undefined ? null : toClaimedJob(claimed, leaseExpiresAt),
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
  const first = attemptClaim(ctx, cell);
  if (first.job !== null || waitMs === 0)
    return { code: 200 as const, job: first.job, signals: [] };
  await ctx.claimWaiters.waitForWake(waitMs, ctx.signal);
  const second = attemptClaim(ctx, cell);
  return { code: 200 as const, job: second.job, signals: [] };
});
