import { accessSync, constants, existsSync } from 'node:fs';
import { dirname } from 'node:path';

export const isWritable = async (path: string): Promise<boolean> => {
  const target = existsSync(path) ? path : dirname(path);
  try {
    accessSync(target, constants.W_OK);
    return true;
  } catch {
    return false;
  }
};
