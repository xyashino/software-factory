import { useSyncExternalStore } from 'react';
import type { WorkOrderAction, WorkOrderFilterState } from '../domain/models';
import { workOrdersBus } from './bus';
import {
  getWorkOrdersState,
  subscribeWorkOrdersState,
  type WorkOrdersState,
} from './store';

export const useWorkOrdersState = (): WorkOrdersState =>
  useSyncExternalStore(
    subscribeWorkOrdersState,
    getWorkOrdersState,
    getWorkOrdersState,
  );

export const workOrdersFacade = {
  loadList: (filter: WorkOrderFilterState) =>
    workOrdersBus.trigger('[TRIGGER]_LOAD_LIST', { filter }),
  refreshList: () => workOrdersBus.trigger('[TRIGGER]_REFRESH_LIST'),
  selectOrder: (orderId: string | null) =>
    workOrdersBus.trigger('[TRIGGER]_SELECT_ORDER', { orderId }),
  transitionOrder: (orderId: string, action: WorkOrderAction) =>
    workOrdersBus.trigger('[TRIGGER]_TRANSITION_ORDER', { orderId, action }),
};
