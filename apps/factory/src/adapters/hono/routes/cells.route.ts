import { Hono } from 'hono';
import { honoAdapter } from '../adapter';
import type { AppEnv } from '../types';
import { enrollCellProcedure } from '../../../application/procedures/cells/enroll-cell.procedure';
import { helloCellProcedure } from '../../../application/procedures/cells/hello-cell.procedure';
import { claimJobProcedure } from '../../../application/procedures/cells/claim-job.procedure';
import { heartbeatCellProcedure } from '../../../application/procedures/cells/heartbeat-cell.procedure';
import { listCellsProcedure } from '../../../application/procedures/cells/list-cells.procedure';
import { revokeCellProcedure } from '../../../application/procedures/cells/revoke-cell.procedure';
import { drainCellProcedure } from '../../../application/procedures/cells/drain.procedure';
import { leaveCellProcedure } from '../../../application/procedures/cells/leave.procedure';

export const cellsRoute = new Hono<AppEnv>()
  .post('/enroll', honoAdapter(enrollCellProcedure))
  .post('/hello', honoAdapter(helloCellProcedure))
  .post('/claims', honoAdapter(claimJobProcedure))
  .post('/heartbeats', honoAdapter(heartbeatCellProcedure))
  .post('/leave', honoAdapter(leaveCellProcedure))
  .post('/:id/drain', honoAdapter(drainCellProcedure))
  .get('/', honoAdapter(listCellsProcedure))
  .delete('/:id', honoAdapter(revokeCellProcedure));
