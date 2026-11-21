import { Hono } from 'hono';
import { honoAdapter } from '../adapter';
import type { AppEnv } from '../types';
import { createWorkOrderProcedure } from '../../../application/procedures/work-orders/create-work-order.procedure';
import { getWorkOrderProcedure } from '../../../application/procedures/work-orders/get-work-order.procedure';
import { listWorkOrdersProcedure } from '../../../application/procedures/work-orders/list-work-orders.procedure';
import { transitionWorkOrderProcedure } from '../../../application/procedures/work-orders/transition-work-order.procedure';

export const workOrdersRoute = new Hono<AppEnv>()
  .post('/', honoAdapter(createWorkOrderProcedure))
  .get('/', honoAdapter(listWorkOrdersProcedure))
  .get('/:id', honoAdapter(getWorkOrderProcedure))
  .post('/:id/transitions', honoAdapter(transitionWorkOrderProcedure));
