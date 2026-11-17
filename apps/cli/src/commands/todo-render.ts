import type {
  ChangeType,
  TodoPriority,
  TodoStatus,
} from '@repo/factory-definitions/todo';

/** One Work order as `todos export` writes it back to a todo file. */
export interface ExportedTodo {
  todoId: string;
  status: TodoStatus;
  priority: TodoPriority;
  type: ChangeType;
  line: string;
  /** todo ids of the todos this one waits for */
  dependsOn: readonly string[];
  /** the Order Plan slug, or null for a plain todo */
  plan: string | null;
  /** everything after the frontmatter, as the Work order stores it */
  body: string;
}

/** A board status as a todo status: cancelled, done (delivered or merged), else todo. */
export const todoStatusOf = (boardStatus: string): TodoStatus => {
  if (boardStatus === 'cancelled') return 'cancelled';
  if (boardStatus === 'delivered' || boardStatus === 'merged') return 'done';
  return 'todo';
};

/**
 * The todo file for one Work order. `factory: v2` lets `todos import` take it without `--all`; the
 * frontmatter is JSON-quoted where it holds text, which is valid YAML.
 */
export const renderTodoFile = (todo: ExportedTodo): string => {
  const lines = [
    `status: ${todo.status}`,
    'factory: v2',
    `priority: ${todo.priority}`,
    `type: ${todo.type}`,
    `line: ${JSON.stringify(todo.line)}`,
    ...(todo.plan === null ? [] : [`plan: ${JSON.stringify(todo.plan)}`]),
    `depends_on: ${JSON.stringify(todo.dependsOn)}`,
  ];
  return `---\n${lines.join('\n')}\n---\n${todo.body}`;
};
