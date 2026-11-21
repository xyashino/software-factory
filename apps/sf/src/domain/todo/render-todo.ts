import { stringify } from 'yaml';
import type { Todo } from './todo';

const FENCE = '---';
const KEY_ORDER = [
  'status',
  'priority',
  'line',
  'plan',
  'depends_on',
  'type',
] as const;

const orderedKeys = (frontmatter: Record<string, unknown>): string[] => {
  const known = KEY_ORDER.filter((key) => key in frontmatter);
  const unknown = Object.keys(frontmatter).filter(
    (key) => !(KEY_ORDER as readonly string[]).includes(key),
  );
  return [...known, ...unknown];
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
