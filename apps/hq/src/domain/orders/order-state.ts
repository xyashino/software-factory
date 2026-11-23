import {
  ORDER_TYPES,
  PLAN_ACTIONS,
  PLAN_STATES,
  PRIORITIES,
  WORK_ORDER_ACTIONS,
  WORK_ORDER_STATES,
} from '@repo/factory-contracts/enums/orders';

export type PlanState = (typeof PLAN_STATES)[number];
export type WorkOrderState = (typeof WORK_ORDER_STATES)[number];
export type Priority = (typeof PRIORITIES)[number];
export type OrderType = (typeof ORDER_TYPES)[number];
export type PlanAction = (typeof PLAN_ACTIONS)[number];
export type WorkOrderAction = (typeof WORK_ORDER_ACTIONS)[number];

const readyOrWaiting = (isReady: boolean): WorkOrderState =>
  isReady ? 'queued' : 'waiting_parent';

export const isStructurallyEditable = (state: WorkOrderState): boolean =>
  state === 'waiting_parent' ||
  state === 'queued' ||
  state === 'paused' ||
  state === 'line_unavailable';

export const nextPlanState = (
  state: PlanState,
  action: PlanAction,
): PlanState | null => {
  switch (action) {
    case 'activate':
      return state === 'draft' ? 'branching' : null;
    case 'retry':
      return state === 'failed' ? 'branching' : null;
    case 'complete':
      return state === 'active' || state === 'ready' ? 'completed' : null;
    case 'cancel':
      return state === 'completed' || state === 'cancelled'
        ? null
        : 'cancelled';
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
};

export const nextWorkOrderState = (
  state: WorkOrderState,
  action: WorkOrderAction,
  isReady: boolean,
): WorkOrderState | null => {
  switch (action) {
    case 'pause':
      return state === 'queued' || state === 'waiting_parent' ? 'paused' : null;
    case 'unpause':
      return state === 'paused' ? readyOrWaiting(isReady) : null;
    case 'resume':
      return state === 'blocked' || state === 'line_unavailable'
        ? readyOrWaiting(isReady)
        : null;
    case 'reset_to_scratch':
      if (state === 'paused') return 'paused';
      return state === 'queued' ||
        state === 'waiting_parent' ||
        state === 'line_unavailable' ||
        state === 'blocked'
        ? readyOrWaiting(isReady)
        : null;
    case 'reopen':
      return state === 'delivered' ||
        state === 'completed' ||
        state === 'cancelled'
        ? readyOrWaiting(isReady)
        : null;
    case 'complete':
      return state === 'delivered' ? 'completed' : null;
    case 'cancel':
      return state === 'completed' || state === 'cancelled'
        ? null
        : 'cancelled';
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
};
