import type {
  getWorkOrderContract,
  workOrderDto,
} from '@repo/hq-contracts/work-orders.contract';
import type { z } from 'zod';
import type { WorkOrder, WorkOrderDetail } from '../domain/models';

type WorkOrderDto = z.infer<typeof workOrderDto>;
type WorkOrderDetailDto = z.infer<(typeof getWorkOrderContract.out)[200]>;

export const mapWorkOrder = (dto: WorkOrderDto): WorkOrder => ({
  orderId: dto.orderId,
  projectId: dto.projectId,
  slug: dto.slug,
  title: dto.title,
  type: dto.type,
  description: dto.description,
  lineName: dto.lineName,
  priority: dto.priority,
  state: dto.state,
  branch: dto.branch,
  baseBranch: dto.baseBranch,
  staleBase: dto.staleBase,
  currentStepIndex: dto.currentStepIndex,
  activeCellId: dto.activeCellId,
  updatedAt: dto.updatedAt,
});

export const mapWorkOrderDetail = (
  dto: WorkOrderDetailDto,
): WorkOrderDetail => ({
  order: mapWorkOrder(dto.order),
  steps: dto.steps,
  jobs: dto.jobs,
  incidents: dto.incidents,
});
