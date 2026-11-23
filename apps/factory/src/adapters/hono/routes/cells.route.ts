import { Hono } from 'hono';
import { honoAdapter } from '../adapter';
import type { AppEnv } from '../types';
import { claimJobProcedure } from '../../../application/procedures/cells/claim-job.procedure';
import { heartbeatCellProcedure } from '../../../application/procedures/cells/heartbeat-cell.procedure';

export const cellsRoute = new Hono<AppEnv>()
  .post('/claims', honoAdapter(claimJobProcedure))
  .post('/heartbeats', honoAdapter(heartbeatCellProcedure));
