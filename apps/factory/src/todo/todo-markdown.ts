import { parse, stringify } from 'yaml';

const FENCE = '---';
const OPEN = `${FENCE}\n`;
const CLOSE = `\n${FENCE}\n`;
const KEY_ORDER = [
  'status',
  'priority',
  'line',
  'plan',
  'depends_on',
  'type',
] as const;

export interface Todo {
  frontmatter: Record<string, unknown>;
  body: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const orderedKeys = (frontmatter: Record<string, unknown>): string[] => {
  const known = KEY_ORDER.filter((key) => key in frontmatter);
  const unknown = Object.keys(frontmatter).filter(
    (key) => !(KEY_ORDER as readonly string[]).includes(key),
  );
  return [...known, ...unknown];
};

export const parseTodo = (text: string): Todo => {
  if (!text.startsWith(OPEN)) {
    return { frontmatter: {}, body: text };
  }
  const closeAt = text.indexOf(CLOSE, OPEN.length - 1);
  if (closeAt === -1) {
    throw new Error('frontmatter is not closed');
  }
  const frontmatter = parse(text.slice(OPEN.length, closeAt + 1)) ?? {};
  if (!isRecord(frontmatter)) {
    throw new Error('frontmatter is not a mapping');
  }
  return { frontmatter, body: text.slice(closeAt + CLOSE.length) };
};

export const renderTodo = (todo: Todo): string => {
  const keys = orderedKeys(todo.frontmatter);
  if (keys.length === 0) {
    return todo.body;
  }
  const ordered = Object.fromEntries(
    keys.map((key) => [key, todo.frontmatter[key]]),
  );
  return `${FENCE}\n${stringify(ordered)}${FENCE}\n${todo.body}`;
};
