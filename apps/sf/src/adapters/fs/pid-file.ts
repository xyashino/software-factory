import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { PidFilePort } from '../../application/ports/pid-file.port';
import type { ProcessPort } from '../../application/ports/process.port';
import { createProcessAdapter } from '../process/spawn';

const PID_FILE_NAME = 'server.pid';
const PID_MODE = 0o600;

const isExistsError = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === 'EEXIST';

export const createPidFile = (
  fileName = PID_FILE_NAME,
  isAlive: ProcessPort['isAlive'] = createProcessAdapter().isAlive,
): PidFilePort => {
  const pidPathOf = (dataDir: string): string => join(dataDir, fileName);
  const readPid = async (dataDir: string): Promise<number | null> => {
    const path = pidPathOf(dataDir);
    if (!existsSync(path)) {
      return null;
    }
    const pid = Number(readFileSync(path, 'utf8').trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  };
  return {
    read: readPid,
    write: async (dataDir, pid) => {
      const path = pidPathOf(dataDir);
      mkdirSync(dataDir, { recursive: true });
      writeFileSync(path, `${pid}\n`, { mode: PID_MODE });
      chmodSync(path, PID_MODE);
    },
    acquire: async (dataDir, pid) => {
      const path = pidPathOf(dataDir);
      mkdirSync(dataDir, { recursive: true });
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          writeFileSync(path, `${pid}\n`, { mode: PID_MODE, flag: 'wx' });
          return true;
        } catch (error) {
          if (!isExistsError(error)) {
            throw error;
          }
        }
        const holder = await readPid(dataDir);
        if (holder !== null && isAlive(holder)) {
          return false;
        }
        rmSync(path, { force: true });
      }
      return false;
    },
    remove: async (dataDir) => {
      rmSync(pidPathOf(dataDir), { force: true });
    },
  };
};
