import type { Hono } from 'hono';
import type { TransportContext } from '../../../application/core/procedure';
import { adminProcedures } from '../../../application/procedures/admin.procedures';
import { mountProcedures } from '../adapter';

export const mountAdminRoutes = (
  app: Hono,
  transport: TransportContext,
): void => mountProcedures(app, adminProcedures, transport);
