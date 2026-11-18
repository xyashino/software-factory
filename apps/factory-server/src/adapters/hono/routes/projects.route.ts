import { Hono } from 'hono';
import { honoAdapter } from '../adapter';
import type { AppEnv } from '../types';
import { listProjectsProcedure } from '../../../application/procedures/projects/list-projects.procedure';
import { upsertProjectProcedure } from '../../../application/procedures/projects/upsert-project.procedure';

export const projectsRoute = new Hono<AppEnv>()
  .post('/', honoAdapter(upsertProjectProcedure))
  .get('/', honoAdapter(listProjectsProcedure));
