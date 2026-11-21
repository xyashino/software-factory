import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const writeTextFile = async (
  path: string,
  text: string,
  mode?: number,
): Promise<void> => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, { mode });
};

export const appendTextFile = async (
  path: string,
  text: string,
): Promise<void> => {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, text);
};
