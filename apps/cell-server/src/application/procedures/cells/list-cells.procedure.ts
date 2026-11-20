import { listCellsContract } from '../../../contracts/cells.contract';
import { publicProcedure } from '../../core/procedure';
import { listRecords, toCellDto } from './cell-views';

export const listCellsProcedure = publicProcedure(listCellsContract)(
  (_input, ctx) => ({
    code: 200 as const,
    cells: listRecords(ctx.db).map(toCellDto),
  }),
);
