import { accessSync, constants, existsSync } from 'node:fs';
import { dirname } from 'node:path';

const nearestExisting = (path: string): string => {
  let current = path;
  while (!existsSync(current) && dirname(current) !== current) {
    current = dirname(current);
  }
  return current;
};

export const isWritable = async (path: string): Promise<boolean> => {
  try {
    accessSync(nearestExisting(path), constants.W_OK);
    return true;
  } catch {
    return false;
  }
};
