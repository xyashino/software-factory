import { z } from 'zod';
import { listCellsContract } from '../../../contracts/cells.contract';
import { define } from '../../core/procedure';
import { readSecret } from '../../core/repo-access';

const CELLS_ROUTE = '/api/v1/cells';

const ListSchema = z.object({}).strict();

export interface CellRow {
  cellId: string;
  projectId: string;
  status: string;
  activeJobId: string | null;
  lastHeartbeatAt: number | null;
}

export interface CellListResult {
  rows: CellRow[];
}

export const listCells = define({ kind: 'supervisor' })(
  ListSchema,
)<CellListResult>(async (_input, ctx) => {
  const secret = await readSecret(ctx);
  const reply = listCellsContract.out[200].parse(
    await ctx.server.get(CELLS_ROUTE, {}, secret),
  );
  return {
    rows: reply.cells.map((cell) => ({
      cellId: cell.cellId,
      projectId: cell.projectId,
      status: cell.status,
      activeJobId: cell.activeJobId,
      lastHeartbeatAt: cell.lastHeartbeatAt,
    })),
  };
});
