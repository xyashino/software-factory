import { parse } from 'yaml';
import {
  ORDER_TYPES,
  PRIORITIES,
  type OrderType,
  type Priority,
} from '../orders/order-state';

export const TODO_STATUSES = ['queued', 'paused', 'cancelled'] as const;

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const FILENAME_PATTERN = /^(.+)\.md$/;
const FRONTMATTER_PATTERN = /^---\n([\s\S]*?)\n---(?:\n|$)/;
const HEADING_PATTERN = /^# ([a-z0-9][a-z0-9-]*): (.+)$/;

export type TodoStatus = (typeof TODO_STATUSES)[number];

export type TodoFile = {
  slug: string;
  title: string;
  status: TodoStatus;
  priority: Priority;
  line: string;
  plan: string | null;
  dependsOn: string | null;
  type: OrderType;
  description: string;
};

export type TodoParseResult =
  { ok: true; todo: TodoFile } | { ok: false; error: string };

class TodoSyntaxError extends Error {}

const fail = (message: string): never => {
  throw new TodoSyntaxError(message);
};

const slugOfFilename = (filename: string): string => {
  const slug = FILENAME_PATTERN.exec(filename)?.[1];
  if (slug === undefined) return fail('filename must end with .md');
  if (!SLUG_PATTERN.test(slug))
    return fail('filename must be a lowercase slug followed by .md');
  return slug;
};

const splitFrontmatter = (
  markdown: string,
): { fields: Map<string, unknown>; body: string } => {
  const text = markdown.replace(/\r\n/g, '\n');
  const match = FRONTMATTER_PATTERN.exec(text);
  if (match === null)
    return fail('file must start with a --- frontmatter block');
  const [whole = '', raw = ''] = match;
  let parsed: unknown;
  try {
    parsed = parse(raw);
  } catch {
    return fail('frontmatter is not valid YAML');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
    return fail('frontmatter must be a YAML mapping');
  return {
    fields: new Map(Object.entries(parsed)),
    body: text.slice(whole.length),
  };
};

const pickOneOf = <T extends string>(
  key: string,
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T => {
  if (value === undefined || value === null) return fallback;
  const match =
    typeof value === 'string'
      ? allowed.find((item) => item === value)
      : undefined;
  return match ?? fail(`${key} must be one of ${allowed.join(', ')}`);
};

const slugOf = (key: string, value: unknown): string | null => {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !SLUG_PATTERN.test(value))
    return fail(`${key} must be a lowercase slug`);
  return value;
};

const dependsOnOf = (value: unknown): string | null => {
  if (value === undefined || value === null) return null;
  const parents: unknown[] = Array.isArray(value) ? value : [value];
  if (parents.length > 1) return fail('depends_on allows at most one parent');
  return slugOf('depends_on', parents[0]);
};

const readHeading = (
  slug: string,
  body: string,
): { title: string; description: string } => {
  const [heading = '', ...rest] = body.trim().split('\n');
  const match = HEADING_PATTERN.exec(heading);
  if (match === null) return fail(`body must start with "# ${slug}: <title>"`);
  const [, headingSlug = '', title = ''] = match;
  if (headingSlug !== slug)
    return fail(`heading slug ${headingSlug} does not match file ${slug}`);
  return { title: title.trim(), description: rest.join('\n').trim() };
};

const parseTodo = (filename: string, markdown: string): TodoFile => {
  const slug = slugOfFilename(filename);
  const { fields, body } = splitFrontmatter(markdown);
  const { title, description } = readHeading(slug, body);
  return {
    slug,
    title,
    description,
    status: pickOneOf(
      'status',
      fields.get('status') === 'todo' ? 'queued' : fields.get('status'),
      TODO_STATUSES,
      'queued',
    ),
    priority: pickOneOf(
      'priority',
      fields.get('priority'),
      PRIORITIES,
      'medium',
    ),
    line: slugOf('line', fields.get('line')) ?? fail('line is required'),
    plan: slugOf('plan', fields.get('plan')),
    dependsOn: dependsOnOf(fields.get('depends_on')),
    type: pickOneOf('type', fields.get('type'), ORDER_TYPES, 'feat'),
  };
};

export const parseTodoMarkdown = (
  filename: string,
  markdown: string,
): TodoParseResult => {
  try {
    return { ok: true, todo: parseTodo(filename, markdown) };
  } catch (error) {
    if (error instanceof TodoSyntaxError)
      return { ok: false, error: error.message };
    throw error;
  }
};

export const formatTodoMarkdown = (todo: TodoFile): string => {
  const frontmatter = [
    `status: ${todo.status}`,
    `priority: ${todo.priority}`,
    `line: ${todo.line}`,
    ...(todo.plan === null ? [] : [`plan: ${todo.plan}`]),
    ...(todo.dependsOn === null ? [] : [`depends_on: ${todo.dependsOn}`]),
    `type: ${todo.type}`,
  ];
  const body = [
    `# ${todo.slug}: ${todo.title}`,
    ...(todo.description === '' ? [] : ['', todo.description]),
  ];
  return ['---', ...frontmatter, '---', '', ...body, ''].join('\n');
};
