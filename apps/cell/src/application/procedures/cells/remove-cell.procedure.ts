import { eq } from 'drizzle-orm';
import { removeCellContract } from '@repo/cell-contracts/cells.contract';
import { cells } from '../../../db/schema/cells';
import { canRemove } from '../../../domain/cells/cell-slot';
import { Conflict } from '../../core/error-handling';
import { publicProcedure } from '../../core/procedure';
import { findRecord } from './cell-views';

export const removeCellProcedure = publicProcedure(removeCellContract)((
  input,
  ctx,
) => {
  const { slot } = findRecord(ctx.db, input.params.id);
  if (!canRemove(slot.runtimeStatus))
    throw new Conflict(
      `cell ${slot.name} is ${slot.runtimeStatus}: stop it first`,
    );
  ctx.db.delete(cells).where(eq(cells.slotId, slot.slotId)).run();
  ctx.eventBus.publish({
    kind: 'cell.removed',
    at: ctx.clock.now(),
    slotId: slot.slotId,
  });
  return { code: 200 as const, slotId: slot.slotId };
});
