import { statSync } from 'node:fs';

/** Whether a path is an existing file holding at least one byte. */
export const nonEmptyFile = (path: string): boolean => {
  try {
    return statSync(path).size > 0;
  } catch {
    return false;
  }
};
