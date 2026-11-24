import { transitionWorkOrderContract } from '@repo/hq-contracts/work-orders.contract';
import { nextWorkOrderState } from '../../../domain/orders/order-state';
import { Conflict } from '../../core/error-handling';
import { scopedProcedure } from '../../core/procedure';
import {
  flushTransitions,
  moveOrder,
  publishCommitted,
  readinessOf,
  requireOrder,
  type Actor,
  type TransitionLog,
} from '../../orders/order-writes';
import { toWorkOrderDto } from '../../orders/order-views';

export const transitionWorkOrderProcedure = scopedProcedure([
  'supervisor:write',
])(transitionWorkOrderContract)(async (input, ctx) => {
  const { action } = input.body;
  const now = ctx.clock.now();
  const actor: Actor = { kind: 'supervisor', id: ctx.principal.tokenId };

  const { row, records } = await ctx.storage.write((tx) => {
    const order = requireOrder(tx, input.params.id);
    const next = nextWorkOrderState(
      order.state,
      action,
      readinessOf(tx, order).isReady,
    );
    if (next === null)
      throw new Conflict(`Work order cannot ${action} from ${order.state}`);
    const log: TransitionLog = [];
    const row = moveOrder(tx, order, next, action, actor, now, log);
    return { row, records: flushTransitions(tx, log) };
  });

  publishCommitted(ctx, records);
  return { code: 200 as const, order: toWorkOrderDto(row) };
});
