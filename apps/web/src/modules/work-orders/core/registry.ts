import { workOrdersBus } from './bus';
import {
  liveStreamSource$,
  liveUpdateRefreshDetail$,
  liveUpdateRefreshList$,
} from './handlers/live-sync.handler';
import {
  detailFailedFact$,
  detailLoadedFact$,
  fetchDetailTask$,
  selectOrderTrigger$,
} from './handlers/load-detail.handler';
import {
  fetchListTask$,
  listFailedFact$,
  listLoadedFact$,
  loadListTrigger$,
} from './handlers/load-list.handler';
import { notifyEffect$ } from './handlers/notify.handler';
import {
  orderTransitionedFact$,
  orderTransitionFailedFact$,
  submitTransitionTask$,
  transitionOrderTrigger$,
} from './handlers/transition-order.handler';

export const registerWorkOrders = workOrdersBus.createRegistry(
  loadListTrigger$,
  fetchListTask$,
  listLoadedFact$,
  listFailedFact$,
  selectOrderTrigger$,
  fetchDetailTask$,
  detailLoadedFact$,
  detailFailedFact$,
  transitionOrderTrigger$,
  submitTransitionTask$,
  orderTransitionedFact$,
  orderTransitionFailedFact$,
  liveStreamSource$,
  liveUpdateRefreshList$,
  liveUpdateRefreshDetail$,
  notifyEffect$,
);
