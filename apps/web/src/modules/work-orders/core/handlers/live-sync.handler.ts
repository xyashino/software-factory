import { Observable, map, mergeMap, of } from 'rxjs';
import { watchDataChanges } from '@/shared/data-sync/integration/data-sync';
import { workOrdersBus } from '../bus';
import { getWorkOrdersState } from '../store';

export const liveStreamSource$ = new Observable<void>((subscriber) =>
  watchDataChanges('work_order', () => subscriber.next()),
).pipe(workOrdersBus.forwardAs('[FACT]_LIVE_UPDATE_RECEIVED'));

export const liveUpdateRefreshList$ = workOrdersBus
  .ofType('[FACT]_LIVE_UPDATE_RECEIVED')
  .pipe(
    map(() => ({
      filter: getWorkOrdersState().filter,
      silent: true,
    })),
    workOrdersBus.forwardAs('[TASK]_FETCH_LIST'),
  );

export const liveUpdateRefreshDetail$ = workOrdersBus
  .ofType('[FACT]_LIVE_UPDATE_RECEIVED')
  .pipe(
    mergeMap(() => {
      const { selectedOrderId } = getWorkOrdersState();
      return selectedOrderId === null
        ? of()
        : of({ orderId: selectedOrderId, silent: true });
    }),
    workOrdersBus.forwardAs('[TASK]_FETCH_DETAIL'),
  );
