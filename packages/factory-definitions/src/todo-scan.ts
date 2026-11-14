import {
  todoIdSchema,
  orderIdOf,
  type OrderId,
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

/**
 * What the queue needs to know about a todo file: its status when the file
 * parses, or `unparseable` when it does not. Absent from the map means no file.
 */
export type TodoFileState = TodoStatus | 'unparseable';

export interface TodoScan {
  /** todos that may become Work orders: parsed, known Line, id not reused */
  todos: Todo[];
  /** every problem found, one per file and cause */
  diagnostics: TodoDiagnostic[];
  /** state of every todo file with a valid id, keyed by OrderId (dependency rule input) */
  fileStates: Map<OrderId, TodoFileState>;
}

/** Options of one scan. `requireV2`: only todos with `factory: v2` may become Work orders (ROADMAP M9). */
export interface TodoScanOptions {
  requireV2?: boolean;
}

/**
 * Parses every todo file and reports why each one is not runnable. Pure: the
 * caller supplies the file texts (I/O is v2-10). `knownLines` are the Line
 * names that exist; `knownOrderIds` are OrderIds that already have a Work
 * order, so a todo re-added after delivery gets a diagnostic, not a second order.
 * With `requireV2`, a todo without `factory: v2` is left out silently: v1 owns it.
 */
export const scanTodos = (
  projectId: ProjectId,
  files: readonly TodoSource[],
  knownLines: ReadonlySet<string>,
  knownOrderIds: ReadonlySet<OrderId> = new Set(),
  options: TodoScanOptions = {},
): TodoScan => {
  const todos: Todo[] = [];
  const diagnostics: TodoDiagnostic[] = [];
  const fileStates = new Map<OrderId, TodoFileState>();
  const seen = new Set<OrderId>();

  for (const { file, text } of files) {
    const parsed = parseTodo(projectId, file, text);
    if (!parsed.ok) {
      diagnostics.push(...parsed.error);
      const id = todoIdSchema.safeParse(todoIdOf(file));
      if (id.success) {
        fileStates.set(orderIdOf(projectId, id.data), 'unparseable');
      }
      continue;
    }

    const { todo } = parsed.value;
    fileStates.set(todo.orderId, todo.status);
    if (options.requireV2 && todo.factory !== 'v2') continue;
    diagnostics.push(...parsed.value.diagnostics);

    if (seen.has(todo.orderId) || knownOrderIds.has(todo.orderId)) {
      diagnostics.push({
        file,
        kind: 'reused_id',
        field: 'file',
        message: `todo id "${todo.todoId}" was already used by ${todo.orderId}; pick a new name`,
      });
      continue;
    }
    seen.add(todo.orderId);

    if (!knownLines.has(todo.line)) {
      diagnostics.push({
        file,
        kind: 'unknown_line',
        field: 'line',
        message: `unknown line "${todo.line}"`,
      });
      continue;
    }

    if (parsed.value.diagnostics.length === 0) {
      todos.push(todo);
    }
  }

  return { todos, diagnostics, fileStates };
};
