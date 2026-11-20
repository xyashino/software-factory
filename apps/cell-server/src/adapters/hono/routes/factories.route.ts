import { Hono } from 'hono';
import { honoAdapter } from '../adapter';
import type { AppEnv } from '../types';
import { listFactoriesProcedure } from '../../../application/procedures/factories/list-factories.procedure';
import { removeFactoryProcedure } from '../../../application/procedures/factories/remove-factory.procedure';
import { setDefaultFactoryProcedure } from '../../../application/procedures/factories/set-default-factory.procedure';
import { upsertFactoryProcedure } from '../../../application/procedures/factories/upsert-factory.procedure';

export const factoriesRoute = new Hono<AppEnv>()
  .get('/', honoAdapter(listFactoriesProcedure))
  .post('/', honoAdapter(upsertFactoryProcedure))
  .post('/:id/default', honoAdapter(setDefaultFactoryProcedure))
  .delete('/:id', honoAdapter(removeFactoryProcedure));
