import { basename } from 'node:path';
import { z } from 'zod';
import {
  orderIdOf,
  todoIdSchema,
  type OrderId,
  type ProjectId,
  type TodoId,
} from '@repo/factory-core/ids';
import { err, ok, type Result } from '@repo/factory-core/result';
import { zodErrors } from './errors';
import { parseYaml, splitFrontmatter } from './frontmatter';

/** The Line a todo runs in when its frontmatter names none. */
const DEFAULT_LINE = 'feature';
const TODO_STATUSES = ['todo', 'done', 'cancelled'] as const;
const PRIORITIES = ['high', 'medium', 'low'] as const;

export type TodoStatus = (typeof TODO_STATUSES)[number];
export type TodoPriority = (typeof PRIORITIES)[number];

/**
 * Why a todo file cannot become a Work order:
 * - `unparseable`: no or bad frontmatter, bad YAML, a schema failure, a bad file name;
 * - `unknown_line`: names a Line that does not exist;
 * - `reused_id`: its OrderId already exists, e.g. a delivered todo re-added;
 * - `line_conflict`: `line` and `workflow` are both set and differ.
 */
export type TodoDiagnosticKind =
  'unparseable' | 'unknown_line' | 'reused_id' | 'line_conflict';

/** One problem with one todo file. `file` is relative to the repo root. */
export interface TodoDiagnostic {
  file: string;
  kind: TodoDiagnosticKind;
  field: string;
  message: string;
}

/** A parsed todo: what the scheduler needs, with no I/O behind it. */
export interface Todo {
  /** path relative to the repo root, `todos/<todoId>.md` */
  file: string;
  orderId: OrderId;
  todoId: TodoId;
  status: TodoStatus;
  priority: TodoPriority;
  /** OrderIds of the todos this one waits for, same project */
  dependsOn: OrderId[];
  /** the Line name the todo selects */
  line: string;
  /** `factory: v2` marks a todo for the v2 intake during the trial (ROADMAP M9) */
  factory?: 'v2';
  body: string;
}

/** A todo that parsed, with any diagnostics that stop it becoming a Work order. */
export interface ParsedTodo {
  todo: Todo;
  diagnostics: TodoDiagnostic[];
}

/** A todo file as the caller read it. Pure: the scanner never reads the disk. */
export interface TodoSource {
  /** path relative to the repo root */
  file: string;
  text: string;
}

const todoFrontmatter = z.object({
  status: z.enum(TODO_STATUSES, { error: 'must be todo, done or cancelled' }),
  priority: z
    .enum(PRIORITIES, { error: 'must be high, medium or low' })
    .default('medium'),
  depends_on: z.array(todoIdSchema).default([]),
  line: z.string().min(1, 'must not be empty').optional(),
  workflow: z.string().min(1, 'must not be empty').optional(),
  factory: z.literal('v2', { error: 'must be v2' }).optional(),
});

/** A todo's id is its file name without `.md`, which must be a valid TodoId. */
export const todoIdOf = (file: string): string => basename(file, '.md');

const unparseable = (
  file: string,
  field: string,
  message: string,
): TodoDiagnostic => ({ file, kind: 'unparseable', field, message });

/**
 * Parses one todo file. Returns the todo and its own diagnostics, or only
 * diagnostics when the file cannot be read as a todo at all. Pure: the caller
 * supplies the file text.
 */
export const parseTodo = (
  projectId: ProjectId,
  file: string,
  text: string,
): Result<ParsedTodo, TodoDiagnostic[]> => {
  const id = todoIdSchema.safeParse(todoIdOf(file));
  if (!id.success) {
    return err([
      unparseable(
        file,
        'file',
        `file name "${todoIdOf(file)}" is not a valid todo id`,
      ),
    ]);
  }

  const split = splitFrontmatter(text);
  if (split === null) {
    return err([
      unparseable(
        file,
        'frontmatter',
        'missing frontmatter: the file must start with a --- block',
      ),
    ]);
  }

  const yaml = parseYaml(file, split.frontmatter);
  if (!yaml.ok) {
    return err(
      yaml.error.map((error) => unparseable(file, error.field, error.message)),
    );
  }

  const parsed = todoFrontmatter.safeParse(yaml.value, { reportInput: true });
  if (!parsed.success) {
    return err(
      zodErrors(file, parsed.error).map((error) =>
        unparseable(file, error.field, error.message),
      ),
    );
  }
  const data = parsed.data;
  const line = data.line ?? data.workflow ?? DEFAULT_LINE;
  const diagnostics: TodoDiagnostic[] = [];
  if (
    data.line !== undefined &&
    data.workflow !== undefined &&
    data.line !== data.workflow
  ) {
    diagnostics.push({
      file,
      kind: 'line_conflict',
      field: 'line',
      message: `line "${data.line}" and workflow "${data.workflow}" differ; set one`,
    });
  }

  const todo: Todo = {
    file,
    orderId: orderIdOf(projectId, id.data),
    todoId: id.data,
    status: data.status,
    priority: data.priority,
    dependsOn: data.depends_on.map((dep) => orderIdOf(projectId, dep)),
    line,
    ...(data.factory === undefined ? {} : { factory: data.factory }),
    body: split.body,
  };
  return ok({ todo, diagnostics });
};
