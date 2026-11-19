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

const PID_FILE_NAME = 'server.pid';
const PID_MODE = 0o600;

const pidPathOf = (dataDir: string): string => join(dataDir, PID_FILE_NAME);

export const createPidFile = (): PidFilePort => ({
  read: async (dataDir) => {
    const path = pidPathOf(dataDir);
    if (!existsSync(path)) {
      return null;
    }
    const pid = Number(readFileSync(path, 'utf8').trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  },
  write: async (dataDir, pid) => {
    const path = pidPathOf(dataDir);
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(path, `${pid}\n`, { mode: PID_MODE });
    chmodSync(path, PID_MODE);
  },
  remove: async (dataDir) => {
    rmSync(pidPathOf(dataDir), { force: true });
  },
});
