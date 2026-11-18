import { Hono } from 'hono';
import { honoAdapter } from '../adapter';
import type { AppEnv } from '../types';
import { createOrderPlanProcedure } from '../../../application/procedures/order-plans/create-order-plan.procedure';
import { getOrderPlanProcedure } from '../../../application/procedures/order-plans/get-order-plan.procedure';
import { listOrderPlansProcedure } from '../../../application/procedures/order-plans/list-order-plans.procedure';
import { transitionOrderPlanProcedure } from '../../../application/procedures/order-plans/transition-order-plan.procedure';

export const orderPlansRoute = new Hono<AppEnv>()
  .post('/', honoAdapter(createOrderPlanProcedure))
  .get('/', honoAdapter(listOrderPlansProcedure))
  .get('/:id', honoAdapter(getOrderPlanProcedure))
  .post('/:id/transitions', honoAdapter(transitionOrderPlanProcedure));
