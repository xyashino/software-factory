import { from, map, merge, switchMap, tap } from 'rxjs';
import { listWorkOrders } from '../../integration/repository';
import {
  applyListFailed,
  applyListLoaded,
  startListLoad,
} from '../actions/work-orders.actions';
import { forwardWorkOrderErrorAs, workOrdersBus } from '../bus';
import { getWorkOrdersState } from '../store';

export const loadListTrigger$ = merge(
  workOrdersBus
    .ofType('[TRIGGER]_LOAD_LIST')
    .pipe(map(({ filter }) => ({ filter, silent: false }))),
  workOrdersBus.ofType('[TRIGGER]_REFRESH_LIST').pipe(
    map(() => ({
      filter: getWorkOrdersState().filter,
      silent: false,
    })),
  ),
).pipe(workOrdersBus.forwardAs('[TASK]_FETCH_LIST'));

export const fetchListTask$ = workOrdersBus.ofType('[TASK]_FETCH_LIST').pipe(
  tap(({ filter, silent }) => startListLoad(filter, silent)),
  switchMap(({ filter }) =>
    from(listWorkOrders(filter)).pipe(
      map((items) => ({ items })),
      workOrdersBus.forwardAs('[FACT]_LIST_LOADED'),
      forwardWorkOrderErrorAs('[FACT]_LIST_FAILED', (error) => ({ error })),
    ),
  ),
);

export const listLoadedFact$ = workOrdersBus
  .ofType('[FACT]_LIST_LOADED')
  .pipe(tap(({ items }) => applyListLoaded(items)));

export const listFailedFact$ = workOrdersBus
  .ofType('[FACT]_LIST_FAILED')
  .pipe(tap(({ error }) => applyListFailed(error)));
