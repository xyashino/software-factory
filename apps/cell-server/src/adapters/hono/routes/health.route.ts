import { Hono } from 'hono';
import { honoAdapter } from '../adapter';
import type { AppEnv } from '../types';
import { getHealthProcedure } from '../../../application/procedures/health/get-health.procedure';

export const healthRoute = new Hono<AppEnv>().get(
  '/',
  honoAdapter(getHealthProcedure),
);
