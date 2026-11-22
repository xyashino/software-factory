import { startCellContract } from '@repo/cell-contracts/cells.contract';
import { canStart } from '../../../domain/cells/cell-slot';
import { Conflict } from '../../core/error-handling';
import { publicProcedure } from '../../core/procedure';
import { findRecord, listRecords, toCellDto } from './cell-views';
import { startSlot } from './slot-runtime';
import { cells } from '../../../db/schema/cells';
import { eq } from 'drizzle-orm';

export const startCellProcedure = publicProcedure(startCellContract)(async (
  input,
  ctx,
) => {
  const record = findRecord(ctx.db, input.params.id);
  if (!canStart(record.slot.runtimeStatus))
    throw new Conflict(`cell ${record.slot.name} is already live`);
  await startSlot(ctx, record);
  const [updated] = listRecords(ctx.db, eq(cells.slotId, record.slot.slotId));
  if (updated === undefined) throw new Conflict('cell disappeared');
  return { code: 200 as const, cell: toCellDto(updated) };
});
