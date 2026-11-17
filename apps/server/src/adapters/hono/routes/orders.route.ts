import type { Hono } from 'hono';
import type { TransportContext } from '../../../application/core/procedure';
import { orderProcedures } from '../../../application/procedures/orders.procedures';
import { mountProcedures } from '../adapter';

export const mountOrderRoutes = (
  app: Hono,
  transport: TransportContext,
): void => mountProcedures(app, orderProcedures, transport);
