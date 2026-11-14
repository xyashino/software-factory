import { createHash } from 'node:crypto';

/**
 * Normalises a todo file before hashing (ROADMAP M4, spec drift): line endings become `\n`, trailing
 * spaces on each line and trailing blank lines go. Whitespace-only edits then keep the hash, so they
 * are not reported as spec drift.
 */
export const normaliseTodoText = (text: string): string =>
  text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n+$/, '\n');

/** `sha256:<hex>` of the normalised todo file. Equal hashes mean an unchanged spec. */
export const todoContentHash = (text: string): string =>
  `sha256:${createHash('sha256').update(normaliseTodoText(text)).digest('hex')}`;
