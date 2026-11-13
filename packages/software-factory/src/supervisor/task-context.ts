import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { splitFrontmatter } from '../definitions/frontmatter';
import type { Workflow } from '../definitions/types';
import { reduce } from '../engine/reduce';
import type { TaskState } from '../engine/state';
import { worktreeDir } from '../paths';
import type { TaskRow } from '../ports/store.port';
import type { SupervisorPorts } from './ports';

/** The task row and its workflow. Throws when either is missing, which is a bug, not a task state. */
export const taskContext = (
  ports: SupervisorPorts,
  taskId: string,
): { task: TaskRow; workflow: Workflow } => {
  const task = ports.store.tasks().find((row) => row.id === taskId);
  if (task === undefined) throw new Error(`task ${taskId} is not in the store`);
  const workflow = ports.definitions.workflows.get(task.workflow);
  if (workflow === undefined) {
    throw new Error(`workflow "${task.workflow}" is not defined`);
  }
  return { task, workflow };
};

export const reduceNow = (
  ports: SupervisorPorts,
  workflow: Workflow,
  taskId: string,
): TaskState => {
  return reduce(workflow, ports.store.events(taskId));
};

/**
 * The todo's body without its frontmatter. Prefers the task worktree, falls back to repo root.
 * Empty when the file is gone, which is the case once the delivery removed it.
 */
export const todoBodyOf = (ports: SupervisorPorts, task: TaskRow): string => {
  const inWorktree = join(worktreeDir(ports.root, task.id), task.todoPath);
  const inRoot = join(ports.root, task.todoPath);
  const path = existsSync(inWorktree)
    ? inWorktree
    : existsSync(inRoot)
      ? inRoot
      : undefined;
  if (path === undefined) return '';
  const text = readFileSync(path, 'utf8');
  return splitFrontmatter(text)?.body.trim() ?? text.trim();
};

export const errorText = (error: unknown): string => {
  return error instanceof Error ? error.message : String(error);
};
