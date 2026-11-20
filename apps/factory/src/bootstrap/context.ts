import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createCellStateFile } from '../adapters/fs/cell-state';
import { createPidFile } from '../adapters/fs/pid-file';
import { createTodoFiles } from '../adapters/fs/todo-files';
import { createTokenFile } from '../adapters/fs/token-file';
import { appendTextFile, writeTextFile } from '../adapters/fs/write-text';
import { createGitAdapter } from '../adapters/git/git';
import { createPrAdapter } from '../adapters/git/gh';
import { createServerClient } from '../adapters/http/server-client';
import { createLoopbackEndpoint } from '../adapters/operator-endpoint/loopback';
import { createRunnerCatalog } from '../adapters/runners/catalog';
import { createHeadlessRunner } from '../adapters/runners/headless';
import { createHerdrRunner } from '../adapters/runners/herdr';
import { createRoutingRunner } from '../adapters/runners/routing';
import { createProcessAdapter } from '../adapters/process/spawn-server';
import { createSystemClock } from '../adapters/process/system-clock';
import type { Ports } from '../application/core/procedure';
import type { CellStatePort } from '../application/ports/cell-state.port';
import {
  CELL_LOG_PATH,
  CELL_STATE_PATH,
  DEFAULT_FACTORY_URL,
  SUPERVISOR_TOKEN_PATH,
} from '../config';

export type Mode = 'supervisor' | 'cell' | 'operator';

const TOKEN_PATH = join(homedir(), '.config', 'factory', 'token');

const notWired = (): never => {
  throw new Error('port not wired');
};

const processPort = createProcessAdapter();

const enrolledCellName =
  (cellState: CellStatePort) => async (): Promise<string> => {
    const session = await cellState.read();
    if (session === null) throw new Error('cell is not enrolled');
    return session.cellId;
  };

const binaryOnPath = async (binary: string): Promise<boolean> =>
  (await processPort.run('which', [binary], process.cwd())).exitCode === 0;

export const buildContext = (): Ports => {
  const cellState = createCellStateFile(
    resolve(process.cwd(), CELL_STATE_PATH),
  );
  return {
    server: createServerClient({
      baseUrl: process.env.FACTORY_URL ?? DEFAULT_FACTORY_URL,
    }),
    fs: {
      readText: async (path) => readFileSync(path, 'utf8'),
      writeText: writeTextFile,
      appendText: appendTextFile,
      exists: async (path) => existsSync(path),
      list: async (dir) => (existsSync(dir) ? readdirSync(dir) : []),
      readStdin: notWired,
    },
    todoFiles: createTodoFiles(),
    tokens: createTokenFile([
      resolve(process.cwd(), SUPERVISOR_TOKEN_PATH),
      TOKEN_PATH,
    ]),
    operator: createLoopbackEndpoint(),
    runner: createRoutingRunner(
      createHeadlessRunner(),
      createHerdrRunner(processPort, enrolledCellName(cellState), {
        home: process.cwd(),
        logPath: resolve(process.cwd(), CELL_LOG_PATH),
      }),
    ),
    runners: createRunnerCatalog(binaryOnPath),
    git: createGitAdapter(processPort),
    pr: createPrAdapter(processPort),
    process: processPort,
    pidFile: createPidFile(),
    webPidFile: createPidFile('web.pid'),
    clock: createSystemClock(),
    cellState,
  };
};
