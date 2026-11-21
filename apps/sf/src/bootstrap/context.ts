import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { resolve } from 'node:path';
import { createCellStateFile } from '../adapters/fs/cell-state';
import { createConnectionStore } from '../adapters/fs/connection-store';
import { createPidFile } from '../adapters/fs/pid-file';
import { createTodoFiles } from '../adapters/fs/todo-files';
import { createTokenFile } from '../adapters/fs/token-file';
import { appendTextFile, writeTextFile } from '../adapters/fs/write-text';
import { createGitAdapter } from '../adapters/git/git';
import { createPrAdapter } from '../adapters/git/gh';
import { createCellServerAdapter } from '../adapters/http/cell-server.adapter';
import { createServerClient } from '../adapters/http/server-client';
import { createLocalSlotStore } from '../adapters/fs/local-slot-store';
import { createLoopbackEndpoint } from '../adapters/operator-endpoint/loopback';
import { createRunnerCatalog } from '../adapters/runners/catalog';
import { createHeadlessRunner } from '../adapters/runners/headless';
import { createHerdrRunner } from '../adapters/runners/herdr';
import { createRoutingRunner } from '../adapters/runners/routing';
import { createProcessAdapter } from '../adapters/process/spawn-server';
import { createSystemClock } from '../adapters/process/system-clock';
import type { Ports } from '../application/core/procedure';
import type { CellStatePort } from '../application/ports/cell-state.port';
import { cellNameOf } from '../domain/cell/cell-name';
import { resolveConnection } from '../domain/connection/connection-config';
import {
  DEFAULT_CELL_SERVER_URL,
  DEFAULT_FACTORY_URL,
  GLOBAL_CONFIG_PATH,
  LEGACY_TOKEN_PATH,
  LOCAL_CELLS_DIR,
  SUPERVISOR_TOKEN_PATH,
  cellLogPathOf,
  cellStatePathOf,
} from '../config';

export type Mode = 'supervisor' | 'cell' | 'operator';

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

const pathLookup = process.platform === 'win32' ? 'where' : 'which';

const binaryOnPath = async (binary: string): Promise<boolean> =>
  (await processPort.run(pathLookup, [binary], process.cwd())).exitCode === 0;

const readOptional = (path: string): string | undefined =>
  existsSync(path) ? readFileSync(path, 'utf8') : undefined;

export const buildContext = (cellName?: string): Ports => {
  const name = cellNameOf(cellName ?? hostname());
  const cellState = createCellStateFile(
    resolve(process.cwd(), cellStatePathOf(name)),
  );
  const connections = createConnectionStore(GLOBAL_CONFIG_PATH);
  const repoTokenPath = resolve(process.cwd(), SUPERVISOR_TOKEN_PATH);
  const connection = resolveConnection({
    envUrl: process.env.FACTORY_URL,
    envToken: process.env.FACTORY_TOKEN,
    repoToken: readOptional(repoTokenPath),
    legacyToken: readOptional(LEGACY_TOKEN_PATH),
    config: connections.read(),
    defaultUrl: DEFAULT_FACTORY_URL,
  });
  return {
    server: createServerClient({ baseUrl: connection.url }),
    connection,
    connections,
    fs: {
      readText: async (path) => readFileSync(path, 'utf8'),
      writeText: writeTextFile,
      appendText: appendTextFile,
      exists: async (path) => existsSync(path),
      list: async (dir) => (existsSync(dir) ? readdirSync(dir) : []),
      readStdin: notWired,
    },
    todoFiles: createTodoFiles(),
    tokens: createTokenFile(connection, repoTokenPath),
    operator: createLoopbackEndpoint(),
    runner: createRoutingRunner(
      createHeadlessRunner(),
      createHerdrRunner(processPort, enrolledCellName(cellState), {
        home: process.cwd(),
        logPath: resolve(process.cwd(), cellLogPathOf(name)),
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
    cellServer: createCellServerAdapter({
      baseUrl: process.env.CELL_SERVER_URL ?? DEFAULT_CELL_SERVER_URL,
    }),
    cellServerPidFile: createPidFile('cell-server.pid'),
    localSlots: createLocalSlotStore(LOCAL_CELLS_DIR),
  };
};
