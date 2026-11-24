import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const XDG_DATA_HOME =
  process.env.XDG_DATA_HOME ||
  (process.platform === 'win32'
    ? process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')
    : join(homedir(), '.local', 'share'));
const XDG_CONFIG_HOME =
  process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
const DEFAULT_CONFIG_DIR = join(XDG_CONFIG_HOME, 'sf');
const DEFAULT_FACTORY_PORT = 7072;
const COMPILED_URL_PATTERN = /\/(\$bunfs|~BUN)\//;

export const DEFAULT_DATA_DIR = join(XDG_DATA_HOME, 'sf');
export const FACTORY_CREDENTIAL_PATH = join(DEFAULT_CONFIG_DIR, 'factory.json');
export const FACTORY_PID_FILE = 'factory.pid';
export const FACTORY_LOCAL_DB_PATH = join(DEFAULT_DATA_DIR, 'factory-local.db');
export const FACTORY_PID_ENV = 'SF_FACTORY_PID';
export const FACTORY_DAEMON_PORT = Number(
  process.env.SF_FACTORY_PORT ?? DEFAULT_FACTORY_PORT,
);
export const FACTORY_DAEMON_URL = `http://127.0.0.1:${FACTORY_DAEMON_PORT}`;
export const LOCAL_CELLS_DIR = join(DEFAULT_DATA_DIR, 'cells');
export const REPO_CONFIG_PATH = '.factory/config.json';
export const CELL_ID_ENV = 'FACTORY_CELL_ID';
export const CELL_LINES_ENV = 'CELL_LINES';
export const HEARTBEAT_INTERVAL_MS = 10_000;
export const SELF_FENCE_MS = 45_000;
export const LEASE_TTL_MS = 60_000;
export const IS_COMPILED = COMPILED_URL_PATTERN.test(import.meta.url);
export const CLI_ENTRY = fileURLToPath(
  new URL('../../sf/src/cli.ts', import.meta.url),
);

export const cellWorkerLauncherOf = (
  compiled: boolean,
  cliEntry: string,
): string[] => (compiled ? [] : [resolve(cliEntry)]);
