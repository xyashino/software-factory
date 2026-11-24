import type {
  ORDER_TYPES,
  PRIORITIES,
  WORK_ORDER_STATES,
} from '@repo/hq-contracts/enums/orders';
import type { AllowedWebAction } from '@/server/write-guard';

export type WorkOrderState = (typeof WORK_ORDER_STATES)[number];
export type WorkOrderPriority = (typeof PRIORITIES)[number];
export type WorkOrderType = (typeof ORDER_TYPES)[number];
export type WorkOrderAction = AllowedWebAction;
export type WorkOrderFilterState = WorkOrderState | 'all';

export type WorkOrder = {
  orderId: string;
  projectId: string;
  slug: string;
  title: string;
  type: WorkOrderType;
  description: string;
  lineName: string;
  priority: WorkOrderPriority;
  state: WorkOrderState;
  branch: string;
  baseBranch: string;
  staleBase: boolean;
  currentStepIndex: number;
  activeCellId: string | null;
  updatedAt: number;
};

export type WorkOrderStep = {
  stepId: string;
  stepIndex: number;
  stationId: string;
  kind: string;
  state: string;
};

export type WorkOrderJob = {
  jobId: string;
  kind: string;
  status: string;
  cellId: string | null;
  epoch: number;
};

export type WorkOrderIncident = {
  incidentId: string;
  reason: string;
  status: string;
};

export type WorkOrderDetail = {
  order: WorkOrder;
  steps: WorkOrderStep[];
  jobs: WorkOrderJob[];
  incidents: WorkOrderIncident[];
};

export type WorkOrderError = {
  code: string;
  message: string;
};
