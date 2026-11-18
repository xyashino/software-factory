import { Hono } from 'hono';
import { honoAdapter } from '../adapter';
import type { AppEnv } from '../types';
import { enrollCellProcedure } from '../../../application/procedures/cells/enroll-cell.procedure';
import { helloCellProcedure } from '../../../application/procedures/cells/hello-cell.procedure';

export const cellsRoute = new Hono<AppEnv>()
  .post('/enroll', honoAdapter(enrollCellProcedure))
  .post('/hello', honoAdapter(helloCellProcedure));
