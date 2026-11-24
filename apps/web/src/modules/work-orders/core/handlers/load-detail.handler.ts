import { EMPTY, filter, from, map, switchMap, tap } from 'rxjs';
import { getWorkOrderDetail } from '../../integration/repository';
import {
  applyDetailFailed,
  applyDetailLoaded,
  selectOrder,
} from '../actions/work-orders.actions';
import { forwardWorkOrderErrorAs, workOrdersBus } from '../bus';

export const selectOrderTrigger$ = workOrdersBus
  .ofType('[TRIGGER]_SELECT_ORDER')
  .pipe(
    tap(({ orderId }) => selectOrder(orderId)),
    filter(
      (payload): payload is { orderId: string } => payload.orderId !== null,
    ),
    map(({ orderId }) => ({ orderId, silent: false })),
    workOrdersBus.forwardAs('[TASK]_FETCH_DETAIL'),
  );

export const fetchDetailTask$ = workOrdersBus
  .ofType('[TASK]_FETCH_DETAIL')
  .pipe(
    switchMap(({ orderId }) =>
      orderId.length === 0
        ? EMPTY
        : from(getWorkOrderDetail(orderId)).pipe(
            map((detail) => ({ detail })),
            workOrdersBus.forwardAs('[FACT]_DETAIL_LOADED'),
            forwardWorkOrderErrorAs('[FACT]_DETAIL_FAILED', (error) => ({
              error,
            })),
          ),
    ),
  );

export const detailLoadedFact$ = workOrdersBus
  .ofType('[FACT]_DETAIL_LOADED')
  .pipe(tap(({ detail }) => applyDetailLoaded(detail)));

export const detailFailedFact$ = workOrdersBus
  .ofType('[FACT]_DETAIL_FAILED')
  .pipe(tap(({ error }) => applyDetailFailed(error)));
