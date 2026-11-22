import { Hono } from 'hono';
import { honoAdapter } from '../adapter';
import type { AppEnv } from '../types';
import { enrollFactoryProcedure } from '../../../application/procedures/factories/enroll-factory.procedure';
import { heartbeatFactoryProcedure } from '../../../application/procedures/factories/heartbeat-factory.procedure';
import { goneCellProcedure } from '../../../application/procedures/factories/gone-cell.procedure';
import { listFactoriesProcedure } from '../../../application/procedures/factories/list-factories.procedure';

export const factoriesRoute = new Hono<AppEnv>()
  .post('/enroll', honoAdapter(enrollFactoryProcedure))
  .post('/heartbeat', honoAdapter(heartbeatFactoryProcedure))
  .post('/cells/:id/gone', honoAdapter(goneCellProcedure))
  .get('/', honoAdapter(listFactoriesProcedure));
