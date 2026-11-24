import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { PidFilePort } from '../ports';

export const createPidFile = (fileName: string): PidFilePort => {
  const pidPathOf = (dataDir: string): string => join(dataDir, fileName);
  return {
    read: async (dataDir) => {
      const path = pidPathOf(dataDir);
      if (!existsSync(path)) {
        return null;
      }
      const pid = Number(readFileSync(path, 'utf8').trim());
      return Number.isInteger(pid) && pid > 0 ? pid : null;
    },
    remove: async (dataDir) => {
      rmSync(pidPathOf(dataDir), { force: true });
    },
  };
};
