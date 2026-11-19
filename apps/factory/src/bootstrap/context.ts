import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createCellStateFile } from '../adapters/fs/cell-state';
import { createPidFile } from '../adapters/fs/pid-file';
import { createTodoFiles } from '../adapters/fs/todo-files';
import { createTokenFile } from '../adapters/fs/token-file';
import { writeTextFile } from '../adapters/fs/write-text';
import { createGitAdapter } from '../adapters/git/git';
import { createPrAdapter } from '../adapters/git/gh';
import { createServerClient } from '../adapters/http/server-client';
import { createRunnerCatalog } from '../adapters/runners/catalog';
import { createHeadlessRunner } from '../adapters/runners/headless';
import { createOperatorEndpoint } from '../adapters/operator-endpoint/bun-endpoint';
import { createProcessAdapter } from '../adapters/process/spawn-server';
import { createSystemClock } from '../adapters/process/system-clock';
import type { Ports } from '../application/core/procedure';
import { CELL_STATE_PATH, DEFAULT_FACTORY_URL } from '../config';

export type Mode = 'supervisor' | 'cell' | 'operator';

const TOKEN_PATH = join(homedir(), '.config', 'factory', 'token');

const notWired = (): never => {
  throw new Error('port not wired');
};

const processPort = createProcessAdapter();

const binaryOnPath = async (binary: string): Promise<boolean> =>
  (await processPort.run('which', [binary], process.cwd())).exitCode === 0;

export const buildContext = (): Ports => ({
  server: createServerClient({
    baseUrl: process.env.FACTORY_URL ?? DEFAULT_FACTORY_URL,
  }),
  fs: {
    readText: async (path) => readFileSync(path, 'utf8'),
    writeText: writeTextFile,
    exists: async (path) => existsSync(path),
    list: async (dir) => (existsSync(dir) ? readdirSync(dir) : []),
    readStdin: notWired,
  },
  todoFiles: createTodoFiles(),
  tokens: createTokenFile(TOKEN_PATH),
  operator: createOperatorEndpoint(),
  runner: createHeadlessRunner(),
  runners: createRunnerCatalog(binaryOnPath),
  git: createGitAdapter(processPort),
  pr: createPrAdapter(processPort),
  process: processPort,
  pidFile: createPidFile(),
  clock: createSystemClock(),
  cellState: createCellStateFile(resolve(process.cwd(), CELL_STATE_PATH)),
});
