import type { Hono } from 'hono';
import type { TransportContext } from '../../../application/core/procedure';
import { planProcedures } from '../../../application/procedures/plans.procedures';
import { mountProcedures } from '../adapter';

export const mountPlanRoutes = (app: Hono, transport: TransportContext): void =>
  mountProcedures(app, planProcedures, transport);
