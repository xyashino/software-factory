import { Hono } from 'hono';
import { honoAdapter } from '../adapter';
import type { AppEnv } from '../types';
import { transitionJobProcedure } from '../../../application/procedures/jobs/transition-job.procedure';

export const jobsRoute = new Hono<AppEnv>().post(
  '/:id/transitions',
  honoAdapter(transitionJobProcedure),
);
