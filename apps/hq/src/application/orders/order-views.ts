import type { orderPlans } from '../../db/schema/plans';
import type { projects } from '../../db/schema/projects';
import type { workOrders } from '../../db/schema/orders';

export type WorkOrderRow = typeof workOrders.$inferSelect;
export type OrderPlanRow = typeof orderPlans.$inferSelect;
export type ProjectRow = typeof projects.$inferSelect;

export const toWorkOrderDto = (row: WorkOrderRow) => ({
  orderId: row.orderId,
  projectId: row.projectId,
  planId: row.planId,
  parentOrderId: row.parentOrderId,
  slug: row.slug,
  title: row.title,
  type: row.type,
  description: row.description,
  lineName: row.lineName,
  priority: row.priority,
  state: row.state,
  baseBranch: row.baseBranch,
  baseCommitSha: row.baseCommitSha,
  branch: row.branch,
  headCommitSha: row.headCommitSha,
  staleBase: row.staleBase === 1,
  currentStepIndex: row.currentStepIndex,
  pinnedFactoryId: row.pinnedFactoryId,
  activeCellId: row.activeCellId,
  activeJobId: row.activeJobId,
  epoch: row.epoch,
  unavailableLineFactoryIds: row.unavailableLineFactoriesJson,
  version: row.version,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export const toOrderPlanDto = (row: OrderPlanRow) => ({
  planId: row.planId,
  projectId: row.projectId,
  slug: row.slug,
  title: row.title,
  baseBranch: row.baseBranch,
  branch: row.branch,
  branchCommitSha: row.branchCommitSha,
  state: row.state,
  failureDetail: row.failureDetail,
  version: row.version,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});
