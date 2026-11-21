import { Hono } from 'hono';
import { honoAdapter } from '../adapter';
import type { AppEnv } from '../types';
import { exportQueueProcedure } from '../../../application/procedures/queue/export-queue.procedure';
import { importQueueProcedure } from '../../../application/procedures/queue/import-queue.procedure';
import { queueActionsProcedure } from '../../../application/procedures/queue/queue-actions.procedure';

export const queueRoute = new Hono<AppEnv>()
  .get('/export', honoAdapter(exportQueueProcedure))
  .post('/import', honoAdapter(importQueueProcedure))
  .post('/actions', honoAdapter(queueActionsProcedure));
