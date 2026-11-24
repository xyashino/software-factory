import type {
  EffectEvent,
  FactEvent,
  TaskEvent,
  TriggerEvent,
} from '@/libs/eda/eda';
import type { ToastTone } from '@/shared/ui/toast';
import type {
  WorkOrder,
  WorkOrderAction,
  WorkOrderDetail,
  WorkOrderError,
  WorkOrderFilterState,
} from './models';

export type WorkOrdersEvent =
  | TriggerEvent<'[TRIGGER]_LOAD_LIST', { filter: WorkOrderFilterState }>
  | TriggerEvent<'[TRIGGER]_REFRESH_LIST'>
  | TriggerEvent<'[TRIGGER]_SELECT_ORDER', { orderId: string | null }>
  | TriggerEvent<
      '[TRIGGER]_TRANSITION_ORDER',
      { orderId: string; action: WorkOrderAction }
    >
  | TaskEvent<
      '[TASK]_FETCH_LIST',
      { filter: WorkOrderFilterState; silent: boolean }
    >
  | TaskEvent<'[TASK]_FETCH_DETAIL', { orderId: string; silent: boolean }>
  | TaskEvent<
      '[TASK]_SUBMIT_TRANSITION',
      { orderId: string; action: WorkOrderAction }
    >
  | FactEvent<'[FACT]_LIST_LOADED', { items: WorkOrder[] }>
  | FactEvent<'[FACT]_LIST_FAILED', { error: WorkOrderError }>
  | FactEvent<'[FACT]_DETAIL_LOADED', { detail: WorkOrderDetail }>
  | FactEvent<'[FACT]_DETAIL_FAILED', { error: WorkOrderError }>
  | FactEvent<
      '[FACT]_ORDER_TRANSITIONED',
      { order: WorkOrder; action: WorkOrderAction }
    >
  | FactEvent<
      '[FACT]_ORDER_TRANSITION_FAILED',
      { orderId: string; action: WorkOrderAction; error: WorkOrderError }
    >
  | FactEvent<'[FACT]_LIVE_UPDATE_RECEIVED'>
  | EffectEvent<
      '[EFFECT]_NOTIFY',
      { title: string; description?: string; tone: ToastTone }
    >;
