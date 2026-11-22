import { eq } from 'drizzle-orm';
import { stopCellContract } from '@repo/cell-contracts/cells.contract';
import { cells } from '../../../db/schema/cells';
import { publicProcedure } from '../../core/procedure';
import { findRecord, listRecords, toCellDto } from './cell-views';
import { stopSlot } from './slot-runtime';

export const stopCellProcedure = publicProcedure(stopCellContract)(async (
  input,
  ctx,
) => {
  const record = findRecord(ctx.db, input.params.id);
  await stopSlot(ctx, record, input.body?.force ?? false);
  const [updated] = listRecords(ctx.db, eq(cells.slotId, record.slot.slotId));
  return { code: 200 as const, cell: toCellDto(updated ?? record) };
});
