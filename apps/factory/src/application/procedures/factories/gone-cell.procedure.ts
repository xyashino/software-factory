import { eq } from 'drizzle-orm';
import { goneCellContract } from '@repo/factory-contracts/factories.contract';
import { immediateTx } from '../../../db/client';
import { cells } from '../../../db/schema/cells';
import { safeTokens } from '../../../db/schema/tokens';
import { asCellId } from '../../../domain/common/brand';
import { Forbidden } from '../../core/error-handling';
import { scopedProcedure } from '../../core/procedure';
import { goneCell } from '../cells/gone-cell';
import {
  flushTransitions,
  publishCommitted,
  type TransitionLog,
} from '../../orders/order-writes';

export const goneCellProcedure = scopedProcedure(['factory:worker'])(
  goneCellContract,
)((input, ctx) => {
  const cellId = asCellId(input.params.id);
  const now = ctx.clock.now();

  const records = immediateTx(ctx.db, (tx) => {
    const token = tx
      .select()
      .from(safeTokens)
      .where(eq(safeTokens.tokenId, ctx.principal.tokenId))
      .get();
    if (token === undefined || token.factoryId === null)
      throw new Forbidden('Token is not bound to a factory');
    const cell = tx.select().from(cells).where(eq(cells.cellId, cellId)).get();
    if (cell === undefined) return [];
    if (cell.factoryId !== token.factoryId)
      throw new Forbidden(`Cell ${cellId} belongs to another factory`);

    const log: TransitionLog = [];
    goneCell(tx, cellId, now, { kind: 'system', id: token.factoryId }, log);
    return flushTransitions(tx, log);
  });
  publishCommitted(ctx, records);

  return { code: 200 as const, cellId };
});
