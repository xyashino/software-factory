import {
  appendFileSync,
  chmodSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';

export const writeTextFile = async (
  path: string,
  text: string,
  mode?: number,
): Promise<void> => {
  mkdirSync(dirname(path), { recursive: true });
  const staging = `${path}.tmp-${process.pid}`;
  writeFileSync(staging, text, { mode });
  // umask can strip bits from the mode given at create time, so set it explicitly.
  if (mode !== undefined) {
    chmodSync(staging, mode);
  }
  renameSync(staging, path);
};

export const appendTextFile = async (
  path: string,
  text: string,
): Promise<void> => {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, text);
};

export const removeFile = async (path: string): Promise<void> => {
  rmSync(path, { force: true });
};
