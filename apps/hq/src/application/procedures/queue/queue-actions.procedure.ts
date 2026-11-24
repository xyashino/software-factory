import { queueActionsContract } from '@repo/hq-contracts/queue.contract';
import type { WorkOrderAction } from '../../../domain/orders/order-state';
import { nextWorkOrderState } from '../../../domain/orders/order-state';
import { Conflict } from '../../core/error-handling';
import type { ContractInput } from '@repo/zod-contract-kit/types';
import { scopedProcedure } from '../../core/procedure';
import type { StorageWriteTx, WorkOrderRow } from '../../ports/storage.port';
import {
  flushTransitions,
  moveOrder,
  orderTransition,
  publishCommitted,
  readinessOf,
  requireOrder,
  updateWorkOrder,
  type Actor,
  type TransitionLog,
} from '../../orders/order-writes';

type QueueActionBody = ContractInput<typeof queueActionsContract>['body'];

const moveBy = (
  tx: StorageWriteTx,
  row: WorkOrderRow,
  action: Extract<
    WorkOrderAction,
    'pause' | 'unpause' | 'reset_to_scratch' | 'cancel'
  >,
  actor: Actor,
  now: number,
  log: TransitionLog,
): WorkOrderRow => {
  const next = nextWorkOrderState(
    row.state,
    action,
    readinessOf(tx, row).isReady,
  );
  if (next === null)
    throw new Conflict(
      `Work order ${row.slug} cannot ${action} from ${row.state}`,
    );
  return moveOrder(tx, row, next, action, actor, now, log);
};

const applyAction = (
  tx: StorageWriteTx,
  row: WorkOrderRow,
  body: QueueActionBody,
  actor: Actor,
  now: number,
  log: TransitionLog,
): WorkOrderRow => {
  switch (body.action) {
    case 'reprioritise': {
      const updated = updateWorkOrder(
        tx,
        row,
        { priority: body.priority },
        now,
      );
      log.push(
        orderTransition({
          projectId: row.projectId,
          entityType: 'work_order',
          entityId: row.orderId,
          fromState: row.state,
          toState: row.state,
          actor,
          at: now,
        }),
      );
      return updated;
    }
    case 'pause':
    case 'unpause':
    case 'reset_to_scratch':
    case 'cancel':
      return moveBy(tx, row, body.action, actor, now, log);
    default: {
      const _exhaustive: never = body;
      return _exhaustive;
    }
  }
};

export const queueActionsProcedure = scopedProcedure(['supervisor:write'])(
  queueActionsContract,
)(async (input, ctx) => {
  const body = input.body;
  const now = ctx.clock.now();
  const actor: Actor = { kind: 'supervisor', id: ctx.principal.tokenId };
  const orderIds = [...new Set(body.orderIds)];

  const { orders, records } = await ctx.storage.write((tx) => {
    const log: TransitionLog = [];
    const updated = orderIds.map((orderId) =>
      applyAction(tx, requireOrder(tx, orderId), body, actor, now, log),
    );
    return { orders: updated, records: flushTransitions(tx, log) };
  });

  publishCommitted(ctx, records);
  return {
    code: 200 as const,
    orders: orders.map((row) => ({
      orderId: row.orderId,
      state: row.state,
      priority: row.priority,
    })),
  };
});
