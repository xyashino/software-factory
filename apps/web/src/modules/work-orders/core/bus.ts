import { eda } from '@/libs/eda/eda';
import type { WorkOrdersEvent } from '../domain/events';
import { toWorkOrderError } from '../integration/repository';

export const workOrdersBus = eda<WorkOrdersEvent>();

export const forwardWorkOrderErrorAs =
  workOrdersBus.createForwardErrorAs(toWorkOrderError);
