import { fileURLToPath } from 'node:url';

export const DEFAULT_FACTORY_URL = 'http://127.0.0.1:7070';
export const DEFAULT_PORT = 7070;
export const DEFAULT_DATA_DIR = './.factory-local';
export const DEFAULT_DB_PATH = './.factory-local/factory.db';
export const SERVER_ENTRY = fileURLToPath(
  new URL('../../factory-server/src/index.ts', import.meta.url),
);
export const CLAIM_WAIT_MS = 25_000;
export const HEARTBEAT_INTERVAL_MS = 10_000;
export const SELF_FENCE_MS = 45_000;
export const LEASE_TTL_MS = 60_000;
export const MAX_BODY_BYTES = 1024 * 1024;
export const REPO_CONFIG_PATH = '.factory/config.json';
export const DEFAULT_TODO_DIR = 'todos';
