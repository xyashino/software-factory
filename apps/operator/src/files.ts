import { readFileSync } from 'node:fs';

const STDIN_PATH = '-';

export type FileRead =
  { kind: 'ok'; text: string } | { kind: 'argument_error'; message: string };

const readText = (path: string): string =>
  path === STDIN_PATH ? readFileSync(0, 'utf8') : readFileSync(path, 'utf8');

export const readInputFile = (path: string): FileRead => {
  try {
    return { kind: 'ok', text: readText(path) };
  } catch {
    return {
      kind: 'argument_error',
      message:
        path === STDIN_PATH ? 'cannot read stdin' : `cannot read file: ${path}`,
    };
  }
};
