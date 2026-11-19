import { eq } from 'drizzle-orm';
import { immediateTx, type DbTx } from '../../../db/client';
import { cells } from '../../../db/schema/cells';
import { jobs } from '../../../db/schema/jobs';
import { LEASE_TTL_MS } from '../../../config';
import { helloCellContract } from '../../../contracts/cells.contract';
import type {
  CellId,
  JobId,
  OrderId,
  StepId,
} from '../../../domain/common/brand';
import { addMs, isExpired } from '../../../domain/common/time';
import { Forbidden, NotFound } from '../../core/error-handling';
import { scopedProcedure } from '../../core/procedure';
import {
  flushTransitions,
  orderTransition,
  publishCommitted,
  requireProject,
  type TransitionLog,
} from '../../orders/order-writes';

const RESUMABLE_JOB_STATUSES = ['claimed', 'running'] as const;

type ResumedJob = {
  jobId: JobId;
  orderId: OrderId | null;
  stepId: StepId | null;
  epoch: number;
  leaseExpiresAt: number;
};

const findCell = (tx: DbTx, cellId: CellId) =>
  tx.select().from(cells).where(eq(cells.cellId, cellId)).get();

const resumeActiveJob = (
  tx: DbTx,
  activeJobId: JobId | null,
  now: number,
): ResumedJob | undefined => {
  if (activeJobId === null) return undefined;
  const job = tx.select().from(jobs).where(eq(jobs.jobId, activeJobId)).get();
  if (job === undefined || job.leaseExpiresAt === null) return undefined;
  if (!RESUMABLE_JOB_STATUSES.some((status) => status === job.status))
    return undefined;
  if (isExpired(job.leaseExpiresAt, now)) return undefined;

  const epoch = job.epoch + 1;
  const leaseExpiresAt = addMs(now, LEASE_TTL_MS);
  tx.update(jobs)
    .set({ epoch, leaseExpiresAt })
    .where(eq(jobs.jobId, job.jobId))
    .run();
  return {
    jobId: job.jobId,
    orderId: job.orderId,
    stepId: job.stepId,
    epoch,
    leaseExpiresAt,
  };
};

export const helloCellProcedure = scopedProcedure(['cell:worker'])(
  helloCellContract,
)((input, ctx) => {
  const cellId = ctx.principal.cellId;
  if (cellId === null) throw new Forbidden('Token is not bound to a cell');
  const body = input.body;
  const now = ctx.clock.now();

  const outcome = immediateTx(ctx.db, (tx) => {
    const cell = findCell(tx, cellId);
    if (cell === undefined) throw new NotFound(`Cell ${cellId} not found`);
    if (cell.status === 'revoked') throw new Forbidden('Cell is revoked');
    const project = requireProject(tx, body.projectId);
    const log: TransitionLog = [];
    const reviving = cell.status === 'left';
    if (reviving)
      log.push(
        orderTransition({
          projectId: project.projectId,
          entityType: 'cell',
          entityId: cellId,
          fromState: 'left',
          toState: 'online',
          actor: { kind: 'cell', id: cellId },
          at: now,
        }),
      );

    tx.update(cells)
      .set({
        projectId: project.projectId,
        allowedLinesJson: body.allowedLines,
        runnersJson: body.runners,
        localWorktreesJson: body.localWorktrees,
        lastHeartbeatAt: now,
        status: reviving ? 'online' : cell.status,
      })
      .where(eq(cells.cellId, cellId))
      .run();

    return {
      resumedJob: resumeActiveJob(tx, cell.activeJobId, now),
      records: flushTransitions(tx, log),
    };
  });
  publishCommitted(ctx, outcome.records);

  const { resumedJob } = outcome;
  return resumedJob === undefined
    ? { code: 200 as const, cellId }
    : { code: 200 as const, cellId, resumedJob };
});
