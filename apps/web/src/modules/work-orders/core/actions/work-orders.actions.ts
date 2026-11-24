import type {
  WorkOrder,
  WorkOrderAction,
  WorkOrderDetail,
  WorkOrderError,
  WorkOrderFilterState,
} from '../../domain/models';
import { setWorkOrdersState } from '../store';

export const startListLoad = (
  filter: WorkOrderFilterState,
  silent: boolean,
) => {
  setWorkOrdersState((current) => {
    const hasItems = current.items.length > 0 || current.status === 'ready';
    return {
      ...current,
      filter,
      status: hasItems || silent ? current.status : 'loading',
      refreshing: hasItems && !silent,
      error: null,
    };
  });
};

export const applyListLoaded = (items: WorkOrder[]) => {
  setWorkOrdersState({
    items,
    status: 'ready',
    refreshing: false,
    error: null,
  });
};

export const applyListFailed = (error: WorkOrderError) => {
  setWorkOrdersState((current) => ({
    ...current,
    status: current.items.length > 0 ? 'ready' : 'error',
    refreshing: false,
    error,
  }));
};

export const selectOrder = (orderId: string | null) => {
  setWorkOrdersState((current) => ({
    ...current,
    selectedOrderId: orderId,
    detail: orderId === current.detail?.order.orderId ? current.detail : null,
    detailStatus: orderId === null ? 'idle' : 'loading',
    detailError: null,
  }));
};

export const applyDetailLoaded = (detail: WorkOrderDetail) => {
  setWorkOrdersState((current) =>
    current.selectedOrderId === detail.order.orderId
      ? {
          ...current,
          detail,
          detailStatus: 'ready',
          detailError: null,
        }
      : current,
  );
};

export const applyDetailFailed = (error: WorkOrderError) => {
  setWorkOrdersState({
    detailStatus: 'error',
    detailError: error,
  });
};

export const markActionPending = (orderId: string, action: WorkOrderAction) => {
  setWorkOrdersState((current) => ({
    ...current,
    pendingActions: { ...current.pendingActions, [orderId]: action },
  }));
};

export const clearActionPending = (orderId: string) => {
  setWorkOrdersState((current) => {
    const next = { ...current.pendingActions };
    delete next[orderId];
    return { ...current, pendingActions: next };
  });
};

export const applyOrderUpdated = (order: WorkOrder) => {
  setWorkOrdersState((current) => {
    const matchesFilter =
      current.filter === 'all' || order.state === current.filter;
    const items = matchesFilter
      ? current.items.map((item) =>
          item.orderId === order.orderId ? order : item,
        )
      : current.items.filter((item) => item.orderId !== order.orderId);
    const detail =
      current.detail?.order.orderId === order.orderId
        ? { ...current.detail, order }
        : current.detail;
    return { ...current, items, detail };
  });
};
