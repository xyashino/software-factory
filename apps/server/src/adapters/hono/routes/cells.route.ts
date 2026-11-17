import type { Hono } from 'hono';
import type { TransportContext } from '../../../application/core/procedure';
import { cellProcedures } from '../../../application/procedures/cells.procedures';
import { mountProcedures } from '../adapter';

export const mountCellRoutes = (app: Hono, transport: TransportContext): void =>
  mountProcedures(app, cellProcedures, transport);
