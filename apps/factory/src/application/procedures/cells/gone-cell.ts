import { eq } from 'drizzle-orm';
import type { DbTx } from '../../../db/client';
import { cells } from '../../../db/schema/cells';
import { safeTokens } from '../../../db/schema/tokens';
import type { CellId } from '../../../domain/common/brand';
import { loseActiveJob, unpinOrders } from '../../orders/cell-release';
import type { Actor, TransitionLog } from '../../orders/order-writes';

export const goneCell = (
  tx: DbTx,
  cellId: CellId,
  now: number,
  actor: Actor,
  log: TransitionLog,
): void => {
  const cell = tx.select().from(cells).where(eq(cells.cellId, cellId)).get();
  if (cell === undefined) return;
  loseActiveJob(tx, cell, now, actor, log);
  unpinOrders(tx, cellId, now);
  tx.delete(safeTokens).where(eq(safeTokens.cellId, cellId)).run();
  tx.delete(cells).where(eq(cells.cellId, cellId)).run();
};
