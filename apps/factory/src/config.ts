import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const XDG_DATA_HOME =
  process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share');
export const DEFAULT_FACTORY_URL = 'http://127.0.0.1:7070';
export const DEFAULT_PORT = 7070;
export const DEFAULT_DATA_DIR = join(XDG_DATA_HOME, 'sf');
export const DEFAULT_DB_PATH = join(DEFAULT_DATA_DIR, 'factory.db');
export const SERVER_ENTRY = fileURLToPath(
  new URL('../../factory-server/src/index.ts', import.meta.url),
);
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
export const CELL_STATE_PATH = '.factory-local/cell.json';
export const CELL_LOG_PATH = '.factory-local/cell.log';
export const SUPERVISOR_TOKEN_PATH = '.factory-local/supervisor.token';
export const JOIN_TOKEN_ENV = 'FACTORY_JOIN_TOKEN';
export const DEFAULT_TODO_DIR = 'todos';
export const DEFAULT_WEB_HOST = '127.0.0.1';
export const DEFAULT_WEB_PORT = 4321;
const WEB_ENTRY_FALLBACKS = [
  '/usr/local/share/sf/web/server/entry.mjs',
  '/usr/share/sf/web/server/entry.mjs',
];
const MONOREPO_WEB_ENTRY = fileURLToPath(
  new URL('../../factory-web-demo/dist/server/entry.mjs', import.meta.url),
);

const firstExisting = (candidates: readonly string[]): string | undefined =>
  candidates.find((path) => existsSync(path));

export const webEntryPath = (): string =>
  firstExisting([
    ...(process.env.SF_WEB_DIR
      ? [join(process.env.SF_WEB_DIR, 'server', 'entry.mjs')]
      : []),
    ...WEB_ENTRY_FALLBACKS,
  ]) ?? MONOREPO_WEB_ENTRY;

export const operatorCommandOf = (
  runtime: { execPath: string; entry: string } = {
    execPath: process.execPath,
    entry: resolve(process.argv[1] ?? ''),
  },
): string => {
  if (!/^bun(\.exe)?$/.test(basename(runtime.execPath)))
    return `${runtime.execPath} operator`;
  return `bun ${runtime.entry} operator`;
};
