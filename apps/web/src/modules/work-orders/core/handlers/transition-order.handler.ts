import { from, map, mergeMap, tap } from 'rxjs';
import type { WorkOrderAction } from '../../domain/models';
import { transitionWorkOrder } from '../../integration/repository';
import {
  applyOrderUpdated,
  clearActionPending,
  markActionPending,
} from '../actions/work-orders.actions';
import { forwardWorkOrderErrorAs, workOrdersBus } from '../bus';

const ACTION_PAST_TENSE: Record<WorkOrderAction, string> = {
  pause: 'paused',
  unpause: 'unpaused',
  resume: 'resumed',
  cancel: 'cancelled',
};

export const transitionOrderTrigger$ = workOrdersBus
  .ofType('[TRIGGER]_TRANSITION_ORDER')
  .pipe(workOrdersBus.forwardAs('[TASK]_SUBMIT_TRANSITION'));

export const submitTransitionTask$ = workOrdersBus
  .ofType('[TASK]_SUBMIT_TRANSITION')
  .pipe(
    tap(({ orderId, action }) => markActionPending(orderId, action)),
    mergeMap(({ orderId, action }) =>
      from(transitionWorkOrder(orderId, action)).pipe(
        map((order) => ({ order, action })),
        workOrdersBus.forwardAs('[FACT]_ORDER_TRANSITIONED'),
        forwardWorkOrderErrorAs('[FACT]_ORDER_TRANSITION_FAILED', (error) => ({
          orderId,
          action,
          error,
        })),
      ),
    ),
  );

export const orderTransitionedFact$ = workOrdersBus
  .ofType('[FACT]_ORDER_TRANSITIONED')
  .pipe(
    tap(({ order }) => {
      clearActionPending(order.orderId);
      applyOrderUpdated(order);
    }),
    map(({ order, action }) => ({
      title: `Work order ${ACTION_PAST_TENSE[action]}`,
      description: order.title,
      tone: 'success' as const,
    })),
    workOrdersBus.forwardAs('[EFFECT]_NOTIFY'),
  );

export const orderTransitionFailedFact$ = workOrdersBus
  .ofType('[FACT]_ORDER_TRANSITION_FAILED')
  .pipe(
    tap(({ orderId }) => clearActionPending(orderId)),
    map(({ action, error }) => ({
      title: `Could not ${action} work order`,
      description: `${error.code}: ${error.message}`,
      tone: 'destructive' as const,
    })),
    workOrdersBus.forwardAs('[EFFECT]_NOTIFY'),
  );
