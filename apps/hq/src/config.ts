import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const CLAIM_WAIT_MS = 25_000;
export const HEARTBEAT_INTERVAL_MS = 10_000;
export const LEASE_TTL_MS = 60_000;
export const MAX_WORKTREE_RESETS = 2;
export const MAX_MECHANIC_RUNS = 2;
export const TOKEN_ROTATE_GRACE_MS = 60_000;
export const CELL_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
export const WEB_SESSION_TTL_MS = 24 * 60 * 60 * 1_000;
export const FACTORY_SESSION_TTL_MS = CELL_SESSION_TTL_MS;
export const MAX_CLAIM_WAITERS = 5;
export const MAX_BODY_BYTES = 1_048_576;
export const DEFAULT_RATE_LIMITS = {
  tokenQuota: { limit: 300, windowMs: 60_000 },
  authFailureBrake: { limit: 10, windowMs: 60_000 },
};
export const DEFAULT_PORT = 7070;
export const DEFAULT_HOST = '127.0.0.1';
const XDG_DATA_HOME =
  process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share');
export const DEFAULT_DATA_DIR = join(XDG_DATA_HOME, 'sf');
const DB_FILE_NAME = 'hq.db';
const LEGACY_DB_FILE_NAME = 'factory.db';

export const defaultDbPathOf = (dataDir: string): string => {
  const current = join(dataDir, DB_FILE_NAME);
  if (existsSync(current)) {
    return current;
  }
  const legacy = join(dataDir, LEGACY_DB_FILE_NAME);
  return existsSync(legacy) ? legacy : current;
};
