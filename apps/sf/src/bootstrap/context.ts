import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { resolve } from 'node:path';
import { createConnectionStore } from '../adapters/fs/connection-store';
import { createFactoryCredentialStore } from '../adapters/fs/factory-credential';
import { createPidFile } from '../adapters/fs/pid-file';
import { createTodoFiles } from '../adapters/fs/todo-files';
import { createTokenFile } from '../adapters/fs/token-file';
import {
  appendTextFile,
  removeFile,
  writeTextFile,
} from '../adapters/fs/write-text';
import { createGitAdapter } from '../adapters/git/git';
import { createPrAdapter } from '../adapters/git/gh';
import { createFactoryAdapter } from '../adapters/http/factory.adapter';
import { createHqClient } from '../adapters/http/hq-client';
import { createHqLinkClient } from '../adapters/http/hq-link-client';
import { createLoopbackEndpoint } from '../adapters/operator-endpoint/loopback';
import { createRunnerCatalog } from '../adapters/runners/catalog';
import { createHeadlessRunner } from '../adapters/runners/headless';
import { createHerdrRunner } from '../adapters/runners/herdr';
import { createRoutingRunner } from '../adapters/runners/routing';
import { createProcessAdapter } from '../adapters/process/spawn';
import { createSystemClock } from '../adapters/process/system-clock';
import type { Ports } from '../application/core/procedure';
import { cellNameOf } from '../domain/cell/cell-name';
import { resolveConnection } from '../domain/connection/connection-config';
import { hqTokenEnv, hqUrlEnv } from './hq-env';
import {
  DEFAULT_FACTORY_URL,
  FACTORY_CREDENTIAL_PATH,
  FACTORY_DAEMON_URL,
  FACTORY_PID_FILE,
  GLOBAL_CONFIG_PATH,
  LEGACY_TOKEN_PATH,
  SUPERVISOR_TOKEN_PATH,
  cellLogPathOf,
} from '../config';

export type Mode = 'supervisor' | 'cell' | 'operator';

const processPort = createProcessAdapter();

const pathLookup = process.platform === 'win32' ? 'where' : 'which';

const binaryOnPath = async (binary: string): Promise<boolean> =>
  (await processPort.run(pathLookup, [binary], process.cwd())).exitCode === 0;

const readOptional = (path: string): string | undefined =>
  existsSync(path) ? readFileSync(path, 'utf8') : undefined;

export const buildContext = (cellName?: string): Ports => {
  const name = cellNameOf(cellName ?? hostname());
  const connections = createConnectionStore(GLOBAL_CONFIG_PATH);
  const repoTokenPath = resolve(process.cwd(), SUPERVISOR_TOKEN_PATH);
  const connection = resolveConnection({
    envUrl: hqUrlEnv(),
    envToken: hqTokenEnv(),
    repoToken: readOptional(repoTokenPath),
    legacyToken: readOptional(LEGACY_TOKEN_PATH),
    config: connections.read(),
    defaultUrl: DEFAULT_FACTORY_URL,
  });
  return {
    hq: createHqClient({ baseUrl: connection.url }),
    connection,
    connections,
    fs: {
      readText: async (path) => readFileSync(path, 'utf8'),
      writeText: writeTextFile,
      appendText: appendTextFile,
      remove: removeFile,
      exists: async (path) => existsSync(path),
      list: async (dir) => (existsSync(dir) ? readdirSync(dir) : []),
      readStdin: async () => readFileSync(0, 'utf8'),
    },
    todoFiles: createTodoFiles(),
    tokens: createTokenFile(connection, repoTokenPath),
    operator: createLoopbackEndpoint(),
    runner: createRoutingRunner(
      createHeadlessRunner(),
      createHerdrRunner(processPort, () => Promise.resolve(name), {
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
    factory: createFactoryAdapter({ baseUrl: FACTORY_DAEMON_URL }),
    factoryPidFile: createPidFile(FACTORY_PID_FILE),
    factoryCredential: createFactoryCredentialStore(FACTORY_CREDENTIAL_PATH),
    hqLink: createHqLinkClient(),
  };
};
