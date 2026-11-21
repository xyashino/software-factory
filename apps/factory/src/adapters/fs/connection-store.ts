import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { Refused } from '../../application/core/errors';
import type { ConnectionStorePort } from '../../application/ports/connection-store.port';
import {
  ConnectionConfigSchema,
  EMPTY_CONNECTION_CONFIG,
  type ConnectionConfig,
} from '../../domain/connection/connection-config';

const CONFIG_MODE = 0o600;
const DIR_MODE = 0o700;

const parseFile = (path: string): ConnectionConfig => {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Refused(`connection config ${path} is not valid JSON`);
  }
  const parsed = ConnectionConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Refused(`connection config ${path} has an invalid shape`);
  }
  return parsed.data;
};

export const createConnectionStore = (path: string): ConnectionStorePort => ({
  path,
  read: () =>
    existsSync(path) ? parseFile(path) : { ...EMPTY_CONNECTION_CONFIG },
  write: (config) => {
    const text = `${JSON.stringify(ConnectionConfigSchema.parse(config), null, 2)}\n`;
    mkdirSync(dirname(path), { recursive: true, mode: DIR_MODE });
    const staging = `${path}.tmp-${process.pid}`;
    writeFileSync(staging, text, { mode: CONFIG_MODE });
    chmodSync(staging, CONFIG_MODE);
    renameSync(staging, path);
  },
});
