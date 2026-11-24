import type { WorkOrderState } from '../domain/models';

export const FEATURE_NAME = 'work-orders';

export const FILTER_ALL = 'all';

export const WORK_ORDER_STATE_LABELS: Record<WorkOrderState, string> = {
  waiting_parent: 'Waiting on parent',
  queued: 'Queued',
  paused: 'Paused',
  running: 'Running',
  delivering: 'Delivering',
  delivered: 'Delivered',
  completed: 'Completed',
  line_unavailable: 'Line unavailable',
  blocked: 'Blocked',
  cancelled: 'Cancelled',
};
