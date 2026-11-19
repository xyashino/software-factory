import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const writeTextFile = async (
  path: string,
  text: string,
  mode?: number,
): Promise<void> => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, { mode });
};
