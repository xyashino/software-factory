import { eq } from 'drizzle-orm';
import { immediateTx, type DbTx } from '../../../db/client';
import { cells } from '../../../db/schema/cells';
import { jobs } from '../../../db/schema/jobs';
import { workOrders } from '../../../db/schema/orders';
import { leaveCellContract } from '../../../contracts/cells.contract';
import { asCommandId, type CellId } from '../../../domain/common/brand';
import {
  Conflict,
  Forbidden,
  NotFound,
  StaleLeaseEpoch,
} from '../../core/error-handling';
import { scopedProcedure } from '../../core/procedure';
import {
  findOrder,
  flushTransitions,
  orderTransition,
  publishCommitted,
  updateWorkOrder,
  type Actor,
  type TransitionLog,
} from '../../orders/order-writes';
import { isCommandReplay } from './command-replay';

const ACTIVE_JOB_STATUSES = ['claimed', 'running'] as const;

type CellRow = typeof cells.$inferSelect;
type JobRow = typeof jobs.$inferSelect;

const findCell = (tx: DbTx, cellId: CellId): CellRow | undefined =>
  tx.select().from(cells).where(eq(cells.cellId, cellId)).get();

const liveJobOf = (tx: DbTx, cell: CellRow): JobRow | undefined => {
  if (cell.activeJobId === null) return undefined;
  const job = tx
    .select()
    .from(jobs)
    .where(eq(jobs.jobId, cell.activeJobId))
    .get();
  return job !== undefined &&
    ACTIVE_JOB_STATUSES.some((status) => status === job.status)
    ? job
    : undefined;
};

const unpinOrders = (tx: DbTx, cellId: CellId, now: number): void => {
  const pinned = tx
    .select()
    .from(workOrders)
    .where(eq(workOrders.pinnedCellId, cellId))
    .all();
  for (const row of pinned)
    updateWorkOrder(tx, row, { pinnedCellId: null }, now);
};

const markCellLeft = (
  tx: DbTx,
  cell: CellRow,
  actor: Actor,
  now: number,
  log: TransitionLog,
): void => {
  log.push(
    orderTransition({
      projectId: cell.projectId,
      entityType: 'cell',
      entityId: cell.cellId,
      fromState: cell.status,
      toState: 'left',
      actor,
      at: now,
    }),
  );
  tx.update(cells)
    .set({ status: 'left', activeJobId: null })
    .where(eq(cells.cellId, cell.cellId))
    .run();
};

const leaveWithoutJob = (
  tx: DbTx,
  cell: CellRow,
  jobId: string | undefined,
  actor: Actor,
  now: number,
  log: TransitionLog,
): void => {
  if (jobId !== undefined)
    throw new StaleLeaseEpoch(`Cell ${cell.cellId} holds no job ${jobId}`);
  if (cell.status === 'left') return;
  markCellLeft(tx, cell, actor, now, log);
  unpinOrders(tx, cell.cellId, now);
};

const handOverJob = (
  tx: DbTx,
  cell: CellRow,
  job: JobRow,
  body: { epoch: number; jobId?: string },
  actor: Actor,
  now: number,
  log: TransitionLog,
): void => {
  if (body.jobId === undefined)
    throw new Conflict(`Cell ${cell.cellId} holds job ${job.jobId}`);
  if (job.jobId !== body.jobId || job.epoch !== body.epoch)
    throw new StaleLeaseEpoch(`Job ${body.jobId} epoch ${body.epoch} is stale`);
  if (job.kind !== 'run_operator' || job.orderId === null)
    throw new Conflict(`Job ${job.jobId} cannot be handed over`);
  const order = findOrder(tx, job.orderId);
  if (order === undefined)
    throw new NotFound(`Work order ${job.orderId} not found`);

  const epoch = job.epoch + 1;
  markCellLeft(tx, cell, actor, now, log);
  log.push(
    orderTransition({
      projectId: job.projectId,
      entityType: 'job',
      entityId: job.jobId,
      fromState: job.status,
      toState: 'ready',
      actor,
      at: now,
    }),
  );
  tx.update(jobs)
    .set({
      status: 'ready',
      cellId: null,
      workspaceMode: 'reuse',
      epoch,
      leaseExpiresAt: null,
    })
    .where(eq(jobs.jobId, job.jobId))
    .run();
  log.push(
    orderTransition({
      projectId: order.projectId,
      entityType: 'work_order',
      entityId: order.orderId,
      fromState: order.state,
      toState: 'queued',
      actor,
      at: now,
    }),
  );
  updateWorkOrder(
    tx,
    order,
    { state: 'queued', activeCellId: null, activeJobId: null, epoch },
    now,
  );
};

export const leaveCellProcedure = scopedProcedure(['cell:worker'])(
  leaveCellContract,
)((input, ctx) => {
  const cellId = ctx.principal.cellId;
  if (cellId === null) throw new Forbidden('Token is not bound to a cell');
  const now = ctx.clock.now();
  const actor: Actor = { kind: 'cell', id: cellId };
  const { commandId, epoch, jobId } = input.body;

  const records = immediateTx(ctx.db, (tx) => {
    const cell = findCell(tx, cellId);
    if (cell === undefined) throw new NotFound(`Cell ${cellId} not found`);
    if (isCommandReplay(tx, cellId, commandId)) return [];
    if (cell.status === 'revoked') throw new Forbidden('Cell is revoked');

    const log: TransitionLog = [];
    const job = liveJobOf(tx, cell);
    if (job === undefined) leaveWithoutJob(tx, cell, jobId, actor, now, log);
    else handOverJob(tx, cell, job, { epoch, jobId }, actor, now, log);
    return flushTransitions(tx, log, {
      commandId: asCommandId(commandId),
      meta: {},
    });
  });
  publishCommitted(ctx, records);

  return { code: 200 as const, status: 'left' as const };
});
