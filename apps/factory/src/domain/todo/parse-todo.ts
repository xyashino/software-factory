import { parse } from 'yaml';
import type { Todo } from './todo';

const FENCE = '---';
const OPEN = `${FENCE}\n`;
const CLOSE = `\n${FENCE}\n`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

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
