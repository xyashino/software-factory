import { eq } from 'drizzle-orm';
import { exportQueueContract } from '../../../contracts/queue.contract';
import { orderPlans } from '../../../db/schema/plans';
import { workOrders } from '../../../db/schema/orders';
import type { WorkOrderState } from '../../../domain/orders/order-state';
import {
  formatTodoMarkdown,
  type TodoFile,
  type TodoStatus,
} from '../../../domain/queue/todo-markdown';
import { scopedProcedure } from '../../core/procedure';
import { requireProject } from '../../orders/order-writes';

const statusOf = (state: WorkOrderState): TodoStatus => {
  if (state === 'cancelled') return 'cancelled';
  if (state === 'paused') return 'paused';
  return 'queued';
};

export const exportQueueProcedure = scopedProcedure(['supervisor:read'])(
  exportQueueContract,
)((input, ctx) => {
  const { projectId, planSlug, states } = input.query;
  const project = requireProject(ctx.db, projectId);
  const rows = ctx.db
    .select()
    .from(workOrders)
    .where(eq(workOrders.projectId, project.projectId))
    .all();
  const plans = ctx.db
    .select()
    .from(orderPlans)
    .where(eq(orderPlans.projectId, project.projectId))
    .all();
  const planSlugById = new Map(plans.map((plan) => [plan.planId, plan.slug]));
  const slugById = new Map(rows.map((row) => [row.orderId, row.slug]));

  const files = rows
    .map((row) => {
      const ownPlanSlug =
        row.planId === null ? null : (planSlugById.get(row.planId) ?? null);
      const todo: TodoFile = {
        slug: row.slug,
        title: row.title,
        status: statusOf(row.state),
        priority: row.priority,
        line: row.lineName,
        plan: ownPlanSlug,
        dependsOn:
          row.parentOrderId === null
            ? null
            : (slugById.get(row.parentOrderId) ?? null),
        type: row.type,
        description: row.description,
      };
      return { row, ownPlanSlug, todo };
    })
    .filter(({ row }) => states === undefined || states.includes(row.state))
    .filter(
      ({ ownPlanSlug }) => planSlug === undefined || ownPlanSlug === planSlug,
    )
    .sort((a, b) => a.row.slug.localeCompare(b.row.slug))
    .map(({ row, ownPlanSlug, todo }) => ({
      filename: `${row.slug}.md`,
      slug: row.slug,
      orderId: row.orderId,
      projectId: row.projectId,
      line: row.lineName,
      planSlug: ownPlanSlug,
      state: row.state,
      priority: row.priority,
      markdown: formatTodoMarkdown(todo),
    }));

  return {
    code: 200 as const,
    projectId: project.projectId,
    exportedAt: ctx.clock.now(),
    files,
  };
});
