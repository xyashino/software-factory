import { workOrdersFacade, useWorkOrdersState } from './facade';
import { registerWorkOrders } from './registry';
import { resetWorkOrdersState } from './store';

export const workOrdersMediator = {
  register: registerWorkOrders,
  facade: workOrdersFacade,
  useState: useWorkOrdersState,
  reset: resetWorkOrdersState,
};
