import { Hono } from 'hono';
import { honoAdapter } from '../adapter';
import type { AppEnv } from '../types';
import { enrollCellProcedure } from '../../../application/procedures/cells/enroll-cell.procedure';
import { helloCellProcedure } from '../../../application/procedures/cells/hello-cell.procedure';
import { claimJobProcedure } from '../../../application/procedures/cells/claim-job.procedure';

export const cellsRoute = new Hono<AppEnv>()
  .post('/enroll', honoAdapter(enrollCellProcedure))
  .post('/hello', honoAdapter(helloCellProcedure))
  .post('/claims', honoAdapter(claimJobProcedure));
