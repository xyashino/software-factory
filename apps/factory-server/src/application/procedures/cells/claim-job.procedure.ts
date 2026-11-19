import { and, asc, eq } from 'drizzle-orm';
import { CLAIM_WAIT_MS, LEASE_TTL_MS } from '../../../config';
import { immediateTx, type DbTx } from '../../../db/client';
import { cells } from '../../../db/schema/cells';
import { jobs } from '../../../db/schema/jobs';
import { orderSteps, workOrders } from '../../../db/schema/orders';
import { projects } from '../../../db/schema/projects';
import { claimJobContract } from '../../../contracts/cells.contract';
import {
  selectClaimable,
  type ClaimCandidate,
  type ClaimCell,
} from '../../../domain/cells/claim-eligibility';
import {
  asCellId,
  asJobId,
  asOrderId,
  type CellId,
  type JobId,
} from '../../../domain/common/brand';
import { addMs } from '../../../domain/common/time';
import { Forbidden, NotFound } from '../../core/error-handling';
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
const UNREACHABLE_CELL_STATUSES = ['offline', 'left', 'revoked'] as const;
const NON_CLAIMING_CELL_STATUSES = ['draining', 'left'] as const;

type CellRow = typeof cells.$inferSelect;
type CellStatus = CellRow['status'];
type JobRow = typeof jobs.$inferSelect;
type WorkOrderRow = typeof workOrders.$inferSelect;
type ProjectRow = typeof projects.$inferSelect;

const findCell = (tx: DbTx, cellId: CellId): CellRow | undefined =>
  tx.select().from(cells).where(eq(cells.cellId, cellId)).get();

const isUnreachable = (status: CellStatus | undefined): boolean =>
  status === undefined ||
  UNREACHABLE_CELL_STATUSES.some((unreachable) => unreachable === status);

const holdsActiveJob = (tx: DbTx, cell: CellRow): boolean => {
  if (cell.activeJobId === null) return false;
  const job = tx
    .select()
    .from(jobs)
    .where(eq(jobs.jobId, cell.activeJobId))
    .get();
  return (
    job !== undefined &&
    ACTIVE_JOB_STATUSES.some((status) => status === job.status)
  );
};

const occupyCell = (tx: DbTx, cellId: CellId, jobId: JobId): void => {
  tx.update(cells)
    .set({ activeJobId: jobId, status: 'busy' })
    .where(eq(cells.cellId, cellId))
    .run();
};

const claimPlanBranch = (
  tx: DbTx,
  cell: CellRow,
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
    const claimed = tx
      .update(jobs)
      .set({
        status: 'claimed',
        cellId: cell.cellId,
        epoch: job.epoch + 1,
        leaseExpiresAt,
        startedAt: now,
      })
      .where(eq(jobs.jobId, job.jobId))
      .returning()
      .get();
    occupyCell(tx, cell.cellId, claimed.jobId);
    return claimed;
  }
  return undefined;
};

const claimMechanicJob = (
  tx: DbTx,
  cell: CellRow,
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
        eq(jobs.cellId, cell.cellId),
      ),
    )
    .orderBy(asc(jobs.createdAt), asc(jobs.jobId))
    .get();
  if (job === undefined) return undefined;
  const claimed = tx
    .update(jobs)
    .set({
      status: 'claimed',
      epoch: job.epoch + 1,
      leaseExpiresAt,
      startedAt: now,
    })
    .where(eq(jobs.jobId, job.jobId))
    .returning()
    .get();
  occupyCell(tx, cell.cellId, claimed.jobId);
  return claimed;
};

const toClaimCandidate = (
  row: WorkOrderRow,
  statusByCell: Map<CellId, CellStatus>,
): ClaimCandidate => ({
  orderId: row.orderId,
  projectId: row.projectId,
  state: row.state,
  priority: row.priority,
  lineName: row.lineName,
  createdAt: row.createdAt,
  pinnedCellId: row.pinnedCellId,
  pinnedCellUnavailable:
    row.pinnedCellId !== null &&
    isUnreachable(statusByCell.get(row.pinnedCellId)),
  activeCellId: row.activeCellId,
  activeJobId: row.activeJobId === null ? null : asJobId(row.activeJobId),
  unavailableLineCells: row.unavailableLineCellsJson.map((id) => asCellId(id)),
});

const resumeReadyJob = (
  tx: DbTx,
  row: WorkOrderRow,
  stepId: string | null,
  cellId: CellId,
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
    .set({
      status: 'claimed',
      cellId,
      epoch: job.epoch + 1,
      leaseExpiresAt,
      startedAt: now,
    })
    .where(eq(jobs.jobId, job.jobId))
    .returning()
    .get();
};

const claimWorkOrder = (
  tx: DbTx,
  cell: CellRow,
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
  const statusByCell = new Map(
    tx
      .select()
      .from(cells)
      .where(eq(cells.projectId, cell.projectId))
      .all()
      .map((row) => [row.cellId, row.status] as const),
  );
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
  const claimCell: ClaimCell = {
    cellId: cell.cellId,
    projectId: cell.projectId,
    allowedLines: cell.allowedLinesJson,
    localWorktrees: cell.localWorktreesJson.map((entry) =>
      asOrderId(entry.orderId),
    ),
  };
  const [picked] = selectClaimable(
    rows.map((row) => toClaimCandidate(row, statusByCell)),
    claimCell,
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
      cell.cellId,
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
        payloadJson: { stepIndex: row.currentStepIndex },
        cellId: cell.cellId,
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
      pinnedCellId: cell.cellId,
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
  occupyCell(tx, cell.cellId, job.jobId);
  return job;
};

export const claimNext = (
  tx: DbTx,
  cell: CellRow,
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
  payload: row.payloadJson,
});

const attemptClaim = (ctx: AuthenticatedContext, cellId: CellId) => {
  const now = ctx.clock.now();
  const leaseExpiresAt = addMs(now, LEASE_TTL_MS);
  const outcome = immediateTx(ctx.db, (tx) => {
    const log: TransitionLog = [];
    reapExpiredLeases(tx, now, log);
    const cell = findCell(tx, cellId);
    if (cell === undefined) throw new NotFound(`Cell ${cellId} not found`);
    if (cell.status === 'revoked') throw new Forbidden('Cell is revoked');
    const claimable = !NON_CLAIMING_CELL_STATUSES.some(
      (status) => status === cell.status,
    );
    const claimed =
      !claimable || holdsActiveJob(tx, cell)
        ? undefined
        : claimNext(tx, cell, leaseExpiresAt, now, log);
    return {
      job: claimed === undefined ? null : toClaimedJob(claimed, leaseExpiresAt),
      claimable,
      records: flushTransitions(tx, log),
    };
  });
  publishCommitted(ctx, outcome.records);
  return outcome;
};

export const claimJobProcedure = scopedProcedure(['cell:worker'])(
  claimJobContract,
)(async (input, ctx) => {
  const cellId = ctx.principal.cellId;
  if (cellId === null) throw new Forbidden('Token is not bound to a cell');
  const waitMs = Math.min(input.body?.waitMs ?? 0, CLAIM_WAIT_MS);
  const first = attemptClaim(ctx, cellId);
  if (first.job !== null || waitMs === 0 || !first.claimable)
    return { code: 200 as const, job: first.job };
  await ctx.claimWaiters.waitForWake(waitMs, ctx.signal);
  return { code: 200 as const, job: attemptClaim(ctx, cellId).job };
});
