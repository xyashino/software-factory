import { stopAllCellsContract } from '../../../contracts/cells.contract';
import { publicProcedure } from '../../core/procedure';
import { listRecords, toCellDto } from './cell-views';
import { stopSlot } from './slot-runtime';

export const stopAllCellsProcedure = publicProcedure(stopAllCellsContract)(
  async (input, ctx) => {
    const force = input.body?.force ?? false;
    for (const record of listRecords(ctx.db))
      await stopSlot(ctx, record, force);
    return { code: 200 as const, cells: listRecords(ctx.db).map(toCellDto) };
  },
);
