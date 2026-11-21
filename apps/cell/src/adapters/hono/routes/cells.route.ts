import { Hono } from 'hono';
import { honoAdapter } from '../adapter';
import type { AppEnv } from '../types';
import { createCellsProcedure } from '../../../application/procedures/cells/create-cells.procedure';
import { listCellsProcedure } from '../../../application/procedures/cells/list-cells.procedure';
import { removeCellProcedure } from '../../../application/procedures/cells/remove-cell.procedure';
import { startCellProcedure } from '../../../application/procedures/cells/start-cell.procedure';
import { stopAllCellsProcedure } from '../../../application/procedures/cells/stop-all-cells.procedure';
import { stopCellProcedure } from '../../../application/procedures/cells/stop-cell.procedure';

export const cellsRoute = new Hono<AppEnv>()
  .get('/', honoAdapter(listCellsProcedure))
  .post('/', honoAdapter(createCellsProcedure))
  .post('/stop-all', honoAdapter(stopAllCellsProcedure))
  .post('/:id/start', honoAdapter(startCellProcedure))
  .post('/:id/stop', honoAdapter(stopCellProcedure))
  .delete('/:id', honoAdapter(removeCellProcedure));
