import type {
  WorkOrder,
  WorkOrderAction,
  WorkOrderDetail,
  WorkOrderError,
  WorkOrderFilterState,
} from '../domain/models';

export type WorkOrdersState = {
  filter: WorkOrderFilterState;
  items: WorkOrder[];
  status: 'idle' | 'loading' | 'ready' | 'error';
  refreshing: boolean;
  error: WorkOrderError | null;
  selectedOrderId: string | null;
  detail: WorkOrderDetail | null;
  detailStatus: 'idle' | 'loading' | 'ready' | 'error';
  detailError: WorkOrderError | null;
  pendingActions: Record<string, WorkOrderAction>;
};

type Listener = () => void;

const INITIAL_STATE: WorkOrdersState = {
  filter: 'all',
  items: [],
  status: 'idle',
  refreshing: false,
  error: null,
  selectedOrderId: null,
  detail: null,
  detailStatus: 'idle',
  detailError: null,
  pendingActions: {},
};

const listeners = new Set<Listener>();
let state: WorkOrdersState = INITIAL_STATE;

const notify = () => {
  for (const listener of listeners) listener();
};

export const getWorkOrdersState = (): WorkOrdersState => state;

export const setWorkOrdersState = (
  updater:
    Partial<WorkOrdersState> | ((current: WorkOrdersState) => WorkOrdersState),
) => {
  state =
    typeof updater === 'function' ? updater(state) : { ...state, ...updater };
  notify();
};

export const resetWorkOrdersState = () => {
  state = INITIAL_STATE;
  notify();
};

export const subscribeWorkOrdersState = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
