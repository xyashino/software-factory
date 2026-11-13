import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { z } from 'zod';
import { parseYaml, splitFrontmatter } from '../definitions/frontmatter';
import { listFiles } from '../definitions/files';
import type { TaskRow } from '../ports/store.port';

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 } as const;

const todoFrontmatter = z.object({
  status: z.string(),
  priority: z.enum(['high', 'medium', 'low']).default('medium'),
  depends_on: z.array(z.string()).default([]),
  workflow: z.string().default('feature'),
});

export interface PickedTodo {
  taskId: string;
  todoPath: string;
  workflow: string;
}

export interface TodoScan {
  pick: PickedTodo | undefined;
  /** why a todo was not picked, one line each */
  skipped: string[];
}

/** A todo file's id is its file name without `.md`. */
export const todoIdOf = (todoPath: string): string => {
  return basename(todoPath, '.md');
};

/**
 * The next todo to run: `status: todo`, every dependency satisfied, no task
 * yet for it, highest priority first, then by file name. Only one todo is
 * returned, and the caller starts it.
 */
export const pickTodo = (
  root: string,
  tasks: readonly TaskRow[],
  knownWorkflows: ReadonlySet<string>,
): TodoScan => {
  const files = listFiles(root, 'todos', '.md') ?? [];
  const todoFiles = new Set(files);
  const parsed = files.flatMap((file) => {
    const todo = readTodo(root, file);
    return todo.ok ? [{ file, ...todo.value }] : [];
  });
  const statusById = new Map(parsed.map((todo) => [todo.file, todo.status]));
  const skipped: string[] = [];

  const ready = parsed
    .filter((todo) => todo.status === 'todo')
    .filter((todo) => {
      if (tasks.some((task) => task.todoPath === todo.file)) return false;
      return true;
    })
    .filter((todo) => {
      const missing = todo.depends_on.filter(
        (dep) => !isDelivered(dep, tasks, statusById, todoFiles),
      );
      if (missing.length > 0) {
        skipped.push(`${todo.file}: waiting for ${missing.join(', ')}`);
        return false;
      }
      return true;
    })
    .filter((todo) => {
      if (knownWorkflows.has(todo.workflow)) return true;
      skipped.push(`${todo.file}: unknown workflow "${todo.workflow}"`);
      return false;
    })
    .sort(
      (left, right) =>
        PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority] ||
        left.file.localeCompare(right.file),
    );

  const first = ready[0];
  if (first === undefined) return { pick: undefined, skipped };
  return {
    pick: {
      taskId: todoIdOf(first.file),
      todoPath: first.file,
      workflow: first.workflow,
    },
    skipped,
  };
};

/**
 * A dependency is satisfied when its todo file is absent from `todos/`
 * (delivered todos are removed), is marked `done`, or has a delivered task.
 */
const isDelivered = (
  dep: string,
  tasks: readonly TaskRow[],
  statusById: ReadonlyMap<string, string>,
  todoFiles: ReadonlySet<string>,
): boolean => {
  const todoPath = `todos/${dep}.md`;
  if (!todoFiles.has(todoPath)) return true;
  if (statusById.get(todoPath) === 'done') return true;
  return tasks.some(
    (task) => task.todoPath === todoPath && task.status === 'delivered',
  );
};

const readTodo = (
  root: string,
  file: string,
): { ok: true; value: z.infer<typeof todoFrontmatter> } | { ok: false } => {
  let text: string;
  try {
    text = readFileSync(join(root, file), 'utf8');
  } catch {
    return { ok: false };
  }
  const split = splitFrontmatter(text);
  if (split === null) return { ok: false };
  const yaml = parseYaml(file, split.frontmatter);
  if (!yaml.ok) return { ok: false };
  const result = todoFrontmatter.safeParse(yaml.value);
  return result.success ? { ok: true, value: result.data } : { ok: false };
};
