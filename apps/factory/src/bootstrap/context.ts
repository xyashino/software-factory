import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createPidFile } from '../adapters/fs/pid-file';
import { createTodoFiles } from '../adapters/fs/todo-files';
import { createTokenFile } from '../adapters/fs/token-file';
import { createServerClient } from '../adapters/http/server-client';
import { createProcessAdapter } from '../adapters/process/spawn-server';
import { createSystemClock } from '../adapters/process/system-clock';
import type { Ports } from '../application/core/procedure';
import { DEFAULT_FACTORY_URL } from '../config';

export type Mode = 'supervisor' | 'cell' | 'operator';

const TOKEN_PATH = join(homedir(), '.config', 'factory', 'token');

const notWired = (): never => {
  throw new Error('port not wired');
};

export const buildContext = (): Ports => ({
  server: createServerClient({
    baseUrl: process.env.FACTORY_URL ?? DEFAULT_FACTORY_URL,
  }),
  fs: {
    readText: async (path) => readFileSync(path, 'utf8'),
    writeText: notWired,
    exists: async (path) => existsSync(path),
    readStdin: notWired,
  },
  todoFiles: createTodoFiles(),
  tokens: createTokenFile(TOKEN_PATH),
  operator: { open: notWired, close: notWired },
  runner: { start: notWired, abort: notWired, wait: notWired },
  git: { currentBranch: notWired, isClean: notWired },
  process: createProcessAdapter(),
  pidFile: createPidFile(),
  clock: createSystemClock(),
});
