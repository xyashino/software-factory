import type { OrderId, PlanSlug } from '@repo/factory-core/ids';
import type { Todo } from './todo';

/** The result of checking one plan's chain (CORE §12.2). `chain` is in order, root first. */
export type PlanCheck =
  { ok: true; chain: Todo[] } | { ok: false; reason: string };

/** Member todos of one plan: the todos with `status: todo` that name it. */
const membersOf = (todos: readonly Todo[], slug: PlanSlug): Todo[] =>
  todos.filter((todo) => todo.plan === slug && todo.status === 'todo');

/**
 * Checks the chain of every plan named by `todos`, pure. `todos` are all the parsed todos (any
 * status): a dependency on a todo of another plan is invalid whatever that todo's status. A plan's
 * members are its `todo`-status todos; done and cancelled ones are not part of the chain.
 */
export const validatePlans = (
  todos: readonly Todo[],
): Map<PlanSlug, PlanCheck> => {
  const planOf = new Map<OrderId, PlanSlug>();
  for (const todo of todos) {
    if (todo.plan !== undefined) planOf.set(todo.orderId, todo.plan);
  }
  const slugs = new Set<PlanSlug>();
  for (const todo of todos) {
    if (todo.plan !== undefined && todo.status === 'todo') slugs.add(todo.plan);
  }
  const result = new Map<PlanSlug, PlanCheck>();
  for (const slug of slugs) {
    result.set(slug, checkChain(slug, membersOf(todos, slug), planOf));
  }
  return result;
};

const checkChain = (
  slug: PlanSlug,
  members: readonly Todo[],
  planOf: ReadonlyMap<OrderId, PlanSlug>,
): PlanCheck => {
  const fail = (reason: string): PlanCheck => ({ ok: false, reason });
  const memberIds = new Set(members.map((member) => member.orderId));

  for (const member of members) {
    for (const dep of member.dependsOn) {
      const other = planOf.get(dep);
      if (other !== undefined && other !== slug) {
        return fail(
          `${member.todoId} depends on ${dep.slice(dep.indexOf(':') + 1)}, which is in plan ${other}`,
        );
      }
    }
  }

  const successorOf = new Map<OrderId, Todo>();
  const roots: Todo[] = [];
  for (const member of members) {
    const inPlan = member.dependsOn.filter((dep) => memberIds.has(dep));
    if (inPlan.length > 1) {
      return fail(
        `${member.todoId} depends on ${inPlan.length} todos of the plan; a member may depend on one`,
      );
    }
    if (inPlan.length === 0) {
      roots.push(member);
      continue;
    }
    const predecessor = inPlan[0] as OrderId;
    const other = successorOf.get(predecessor);
    if (other !== undefined) {
      return fail(
        `a branch: ${other.todoId} and ${member.todoId} both depend on ${predecessor.slice(predecessor.indexOf(':') + 1)}`,
      );
    }
    successorOf.set(predecessor, member);
  }

  if (roots.length !== 1) {
    return fail(
      roots.length === 0
        ? 'no root: every member depends on another member (a cycle)'
        : `${roots.length} roots (${roots.map((root) => root.todoId).join(', ')}); a plan has one`,
    );
  }

  const first = roots[0] as Todo;
  const chain: Todo[] = [first];
  const visited = new Set<OrderId>([first.orderId]);
  let current = first;
  for (let next = successorOf.get(current.orderId); next;) {
    if (visited.has(next.orderId)) break;
    visited.add(next.orderId);
    chain.push(next);
    current = next;
    next = successorOf.get(current.orderId);
  }
  if (chain.length !== members.length) {
    return fail('a cycle: some members are not reachable from the root');
  }
  return { ok: true, chain };
};
