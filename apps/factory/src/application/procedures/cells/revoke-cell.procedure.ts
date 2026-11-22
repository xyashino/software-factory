import { and, eq, isNull } from 'drizzle-orm';
import { immediateTx, type DbTx } from '../../../db/client';
import { cells } from '../../../db/schema/cells';
import { jobs } from '../../../db/schema/jobs';
import { workOrders } from '../../../db/schema/orders';
import { safeTokens } from '../../../db/schema/tokens';
import { revokeCellContract } from '@repo/factory-contracts/cells.contract';
import { asCellId, type CellId } from '../../../domain/common/brand';
import { NotFound } from '../../core/error-handling';
import { scopedProcedure } from '../../core/procedure';
import { loseJob } from '../../orders/job-loss';
import {
  flushTransitions,
  publishCommitted,
  updateWorkOrder,
  type Actor,
  type TransitionLog,
} from '../../orders/order-writes';

const ACTIVE_JOB_STATUSES = ['claimed', 'running'] as const;

type CellRow = typeof cells.$inferSelect;

const findCell = (tx: DbTx, cellId: CellId): CellRow | undefined =>
  tx.select().from(cells).where(eq(cells.cellId, cellId)).get();

const unpinOrders = (tx: DbTx, cellId: CellId, now: number): void => {
  const pinned = tx
    .select()
    .from(workOrders)
    .where(eq(workOrders.pinnedCellId, cellId))
    .all();
  for (const row of pinned)
    updateWorkOrder(tx, row, { pinnedCellId: null }, now);
};

const loseActiveJob = (
  tx: DbTx,
  cell: CellRow,
  now: number,
  actor: Actor,
  log: TransitionLog,
): void => {
  if (cell.activeJobId === null) return;
  const job = tx
    .select()
    .from(jobs)
    .where(eq(jobs.jobId, cell.activeJobId))
    .get();
  if (job === undefined || !ACTIVE_JOB_STATUSES.some((s) => s === job.status))
    return;
  loseJob(tx, job, now, actor, log);
};

export const revokeCellProcedure = scopedProcedure(['supervisor:write'])(
  revokeCellContract,
)((input, ctx) => {
  const cellId = asCellId(input.params.id);
  const now = ctx.clock.now();
  const actor: Actor = { kind: 'supervisor', id: ctx.principal.tokenId };

  const records = immediateTx(ctx.db, (tx) => {
    const cell = findCell(tx, cellId);
    if (cell === undefined) throw new NotFound(`Cell ${cellId} not found`);
    if (cell.status === 'revoked') return [];

    const log: TransitionLog = [];
    tx.update(cells)
      .set({ status: 'revoked', revokedAt: now, activeJobId: null })
      .where(eq(cells.cellId, cellId))
      .run();
    tx.update(safeTokens)
      .set({ revokedAt: now })
      .where(and(eq(safeTokens.cellId, cellId), isNull(safeTokens.revokedAt)))
      .run();
    unpinOrders(tx, cellId, now);
    loseActiveJob(tx, cell, now, actor, log);
    return flushTransitions(tx, log);
  });
  publishCommitted(ctx, records);

  return { code: 200 as const };
});
