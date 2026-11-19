import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import type { TokenStorePort } from '../../application/ports/token-store.port';
import type { Access } from '../../domain/access';

const TOKEN_ENV = 'FACTORY_TOKEN';
const TOKEN_MODE = 0o600;

const readSecret = (path: string): string | null => {
  const fromEnv = process.env[TOKEN_ENV]?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  if (!existsSync(path)) {
    return null;
  }
  const fromFile = readFileSync(path, 'utf8').trim();
  return fromFile.length > 0 ? fromFile : null;
};

export const createTokenFile = (path: string): TokenStorePort => ({
  read: async (): Promise<Access | null> =>
    readSecret(path) === null ? null : { kind: 'supervisor' },
  write: async (secret) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${secret}\n`, { mode: TOKEN_MODE });
    chmodSync(path, TOKEN_MODE);
  },
  clear: async () => {
    rmSync(path, { force: true });
  },
});
