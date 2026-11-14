import {
  todoIdSchema,
  orderIdOf,
  type OrderId,
  type PlanSlug,
  type ProjectId,
} from '@repo/factory-core/ids';
import {
  parseTodo,
  todoIdOf,
  type Todo,
  type TodoDiagnostic,
  type TodoSource,
  type TodoStatus,
} from './todo';
import { validatePlans } from './todo-plan';

/**
 * What the queue needs to know about a todo file: its status when the file
 * parses, or `unparseable` when it does not. Absent from the map means no file.
 */
export type TodoFileState = TodoStatus | 'unparseable';

export interface TodoScan {
  /** todos that may become Work orders: parsed, known Line, id not reused, plan (if any) valid */
  todos: Todo[];
  /** every problem found, one per file and cause */
  diagnostics: TodoDiagnostic[];
  /** state of every todo file with a valid id, keyed by OrderId (dependency rule input) */
  fileStates: Map<OrderId, TodoFileState>;
  /** every valid plan's member todos in chain order, root first (CORE §12.2); all runnable */
  planChains: Map<PlanSlug, Todo[]>;
}

/** Options of one scan. `requireV2`: only todos with `factory: v2` may become Work orders (ROADMAP M9). */
export interface TodoScanOptions {
  requireV2?: boolean;
}

/** A todo that parsed and passed the v2 filter, with what its own checks found. */
interface Candidate {
  file: string;
  todo: Todo;
  problems: TodoDiagnostic[];
}

/**
 * Parses every todo file and reports why each one is not runnable. Pure: the
 * caller supplies the file texts (I/O is v2-10). `knownLines` are the Line
 * names that exist; `knownOrderIds` are OrderIds that already have a Work
 * order, so a todo re-added after delivery gets a diagnostic, not a second order.
 * With `requireV2`, a todo without `factory: v2` is left out silently: v1 owns it.
 *
 * A plan (CORE §12.2) is valid only when its chain checks out and every member is runnable. An
 * invalid plan keeps none of its members: each `todo`-status member gets `plan_invalid`.
 */
export const scanTodos = (
  projectId: ProjectId,
  files: readonly TodoSource[],
  knownLines: ReadonlySet<string>,
  knownOrderIds: ReadonlySet<OrderId> = new Set(),
  options: TodoScanOptions = {},
): TodoScan => {
  const fileStates = new Map<OrderId, TodoFileState>();
  // One entry per file in file order: the diagnostics of a file that did not parse, or its candidate.
  const entries: (TodoDiagnostic[] | Candidate)[] = [];
  const candidates: Candidate[] = [];

  for (const { file, text } of files) {
    const parsed = parseTodo(projectId, file, text);
    if (!parsed.ok) {
      entries.push(parsed.error);
      const id = todoIdSchema.safeParse(todoIdOf(file));
      if (id.success) {
        fileStates.set(orderIdOf(projectId, id.data), 'unparseable');
      }
      continue;
    }

    const { todo } = parsed.value;
    fileStates.set(todo.orderId, todo.status);
    if (options.requireV2 && todo.factory !== 'v2') continue;
    const candidate: Candidate = {
      file,
      todo,
      problems: [...parsed.value.diagnostics],
    };
    entries.push(candidate);
    candidates.push(candidate);
  }

  // Own checks: a duplicate or reused id, and an unknown Line, make a todo unrunnable.
  const seen = new Set<OrderId>();
  for (const candidate of candidates) {
    const { file, todo, problems } = candidate;
    if (seen.has(todo.orderId) || knownOrderIds.has(todo.orderId)) {
      problems.push({
        file,
        kind: 'reused_id',
        field: 'file',
        message: `todo id "${todo.todoId}" was already used by ${todo.orderId}; pick a new name`,
      });
    } else {
      seen.add(todo.orderId);
      if (!knownLines.has(todo.line)) {
        problems.push({
          file,
          kind: 'unknown_line',
          field: 'line',
          message: `unknown line "${todo.line}"`,
        });
      }
    }
  }

  // Plan chains over every candidate; a plan is valid only if its chain holds and all members are runnable.
  const checks = validatePlans(candidates.map((candidate) => candidate.todo));
  const invalid = new Map<PlanSlug, string>();
  for (const [slug, check] of checks) {
    if (!check.ok) {
      invalid.set(slug, check.reason);
      continue;
    }
    const blocked = check.chain.find(
      (member) =>
        candidates.find((c) => c.todo.orderId === member.orderId)?.problems
          .length,
    );
    if (blocked) {
      invalid.set(
        slug,
        `member ${blocked.todoId} is not runnable (see its own diagnostic)`,
      );
    }
  }

  const diagnostics: TodoDiagnostic[] = [];
  const todos: Todo[] = [];
  const planChains = new Map<PlanSlug, Todo[]>();
  for (const entry of entries) {
    if (Array.isArray(entry)) {
      diagnostics.push(...entry);
      continue;
    }
    const { file, todo, problems } = entry;
    const blocked =
      todo.status === 'todo' &&
      todo.plan !== undefined &&
      invalid.has(todo.plan);
    if (blocked) {
      problems.push({
        file,
        kind: 'plan_invalid',
        field: 'plan',
        message: `plan ${todo.plan} is invalid: ${invalid.get(todo.plan as PlanSlug)}`,
      });
    }
    diagnostics.push(...problems);
    if (problems.length === 0 && !blocked) todos.push(todo);
  }
  for (const [slug, check] of checks) {
    if (check.ok && !invalid.has(slug)) planChains.set(slug, check.chain);
  }

  return { todos, diagnostics, fileStates, planChains };
};
