import type { Hono } from 'hono';
import type { TransportContext } from '../../../application/core/procedure';
import { projectProcedures } from '../../../application/procedures/projects.procedures';
import { mountProcedures } from '../adapter';

export const mountProjectRoutes = (
  app: Hono,
  transport: TransportContext,
): void => mountProcedures(app, projectProcedures, transport);
