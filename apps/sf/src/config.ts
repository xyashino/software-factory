import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const XDG_DATA_HOME =
  process.env.XDG_DATA_HOME ||
  (process.platform === 'win32'
    ? process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')
    : join(homedir(), '.local', 'share'));
export const XDG_CONFIG_HOME =
  process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
export const DEFAULT_CONFIG_DIR = join(XDG_CONFIG_HOME, 'sf');
export const SYSTEMD_USER_DIR = join(XDG_CONFIG_HOME, 'systemd', 'user');
export const GLOBAL_CONFIG_PATH = join(DEFAULT_CONFIG_DIR, 'config.json');
export const LEGACY_TOKEN_PATH = join(homedir(), '.config', 'factory', 'token');
export const DEFAULT_FACTORY_URL = 'http://127.0.0.1:7070';
export const DEFAULT_PORT = 7070;
export const DEFAULT_FACTORY_PORT = 7072;
export const FACTORY_PORT_ENV = 'SF_FACTORY_PORT';
export const FACTORY_PID_ENV = 'SF_FACTORY_PID';
export const FACTORY_PID_FILE = 'factory.pid';
export const FACTORY_CREDENTIAL_PATH = join(DEFAULT_CONFIG_DIR, 'factory.json');
export const FACTORY_LOG_FILE = 'factory.log';
export const FACTORY_DAEMON_PORT = Number(
  process.env[FACTORY_PORT_ENV] ?? DEFAULT_FACTORY_PORT,
);
export const FACTORY_DAEMON_URL = `http://127.0.0.1:${FACTORY_DAEMON_PORT}`;
export const DEFAULT_DATA_DIR = join(XDG_DATA_HOME, 'sf');
export const DEFAULT_DB_PATH = join(DEFAULT_DATA_DIR, 'factory.db');
export const SERVER_ENTRY = fileURLToPath(
  new URL('../../factory/src/index.ts', import.meta.url),
);
export const COMPILED_URL_PATTERN = /\/(\$bunfs|~BUN)\//;
export const IS_COMPILED = COMPILED_URL_PATTERN.test(import.meta.url);
export const CLI_ENTRY = fileURLToPath(new URL('./cli.ts', import.meta.url));
export const FACTORY_DAEMON_ENTRY = fileURLToPath(
  new URL('./daemon/index.ts', import.meta.url),
);
export const SERVER_MARKER = '__server';
export const WEB_MARKER = '__web';
export const FACTORY_DAEMON_MARKER = '__factory-daemon';
export const CLAIM_WAIT_MS = 25_000;
export const HEARTBEAT_INTERVAL_MS = 10_000;
export const SELF_FENCE_MS = 45_000;
export const LEASE_TTL_MS = 60_000;
export const MAX_BODY_BYTES = 1024 * 1024;
export const REPO_CONFIG_PATH = '.factory/config.json';
export const LINES_DIR = '.factory/lines';
export const OPERATORS_DIR = '.factory/operators';
export const WORKTREES_DIR = '.worktrees';
export const PR_TEMPLATE_PATH = '.factory/templates/pr/body.md';
export const CELLS_DIR = '.factory-local/cells';
export const LOCAL_CELLS_DIR = join(DEFAULT_DATA_DIR, 'cells');
export const SUPERVISOR_TOKEN_PATH = '.factory-local/supervisor.token';
export const JOIN_TOKEN_ENV = 'FACTORY_JOIN_TOKEN';
export const CELL_ID_ENV = 'FACTORY_CELL_ID';
export const CELL_LINES_ENV = 'CELL_LINES';
export const DEFAULT_TODO_DIR = 'todos';
export const DEFAULT_WEB_HOST = '127.0.0.1';
export const DEFAULT_WEB_PORT = 4321;
const WEB_ENTRY_FALLBACKS = [
  join(DEFAULT_DATA_DIR, 'web', 'server', 'entry.mjs'),
  ...(process.platform === 'win32'
    ? []
    : [
        '/usr/local/share/sf/web/server/entry.mjs',
        '/usr/share/sf/web/server/entry.mjs',
      ]),
];
const MONOREPO_WEB_ENTRY = fileURLToPath(
  new URL('../../web-demo/dist/server/entry.mjs', import.meta.url),
);

const firstExisting = (candidates: readonly string[]): string | undefined =>
  candidates.find((path) => existsSync(path));

const quoteIfSpaced = (path: string): string =>
  /\s/.test(path) ? `"${path}"` : path;

export const cellLogPathOf = (name: string): string =>
  join(CELLS_DIR, `${name}.log`);
export const cellPidNameOf = (name: string): string => `${name}.pid`;
export const isRelayedOf = (
  env: Readonly<Record<string, string | undefined>>,
): boolean => env[FACTORY_PID_ENV] !== undefined;

export const webEntryPath = (): string =>
  firstExisting([
    ...(process.env.SF_WEB_DIR
      ? [join(process.env.SF_WEB_DIR, 'server', 'entry.mjs')]
      : []),
    ...WEB_ENTRY_FALLBACKS,
  ]) ?? MONOREPO_WEB_ENTRY;

export const serverArgsOf = (compiled: boolean): string[] =>
  compiled ? [SERVER_MARKER] : [SERVER_ENTRY];

export const factoryDaemonArgsOf = (compiled: boolean): string[] =>
  compiled ? [FACTORY_DAEMON_MARKER] : [FACTORY_DAEMON_ENTRY];

export const cellWorkerLauncherOf = (
  compiled: boolean,
  cliEntry: string,
): string[] => (compiled ? [] : [resolve(cliEntry)]);

export const webArgsOf = (compiled: boolean, entry: string): string[] =>
  compiled ? [WEB_MARKER, entry] : [entry];

export const operatorCommandOf = (
  runtime: { execPath: string; entry: string } = {
    execPath: process.execPath,
    entry: resolve(process.argv[1] ?? ''),
  },
): string => {
  if (!/^bun(\.exe)?$/.test(basename(runtime.execPath)))
    return `${quoteIfSpaced(runtime.execPath)} operator`;
  return `bun ${quoteIfSpaced(runtime.entry)} operator`;
};
