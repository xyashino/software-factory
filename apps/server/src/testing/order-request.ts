import {
  planSlugSchema,
  todoIdSchema,
  type ProjectId,
} from '@repo/factory-core/ids';
import { shippedLine } from '@repo/factory-runtime/seed';

/**
 * The `createPlan` request of an Order Plan with the given todos in chain order, on the shipped `feature`
 * Line (PROTOCOL §3.3). Test helper only.
 */
export const planRequest = (
  projectId: ProjectId,
  slug: string,
  todoIds: readonly string[],
) => ({
  commandId: `plan-${slug}`,
  projectId,
  slug: planSlugSchema.parse(slug),
  members: todoIds.map((todoId) => ({
    todoId: todoIdSchema.parse(todoId),
    title: `Title ${todoId}`,
    type: 'feat' as const,
    body: `Body of ${todoId}\n`,
    line: shippedLine('feature'),
    priority: 'medium' as const,
  })),
});

/**
 * The `createOrder` request of one todo on the shipped `feature` Line: what a Supervisor sends to the
 * task API (PROTOCOL §3.3). Test helper only; the server holds no repository definition.
 */
export const orderRequest = (projectId: ProjectId, todoId: string) => ({
  commandId: `create-${todoId}`,
  projectId,
  todoId: todoIdSchema.parse(todoId),
  title: `Title ${todoId}`,
  type: 'feat' as const,
  body: `Body of ${todoId}\n`,
  line: shippedLine('feature'),
  priority: 'medium' as const,
  dependsOn: [],
  baseBranch: 'main',
});
