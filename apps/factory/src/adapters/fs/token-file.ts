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

const readSecret = (paths: readonly string[]): string | null => {
  const fromEnv = process.env[TOKEN_ENV]?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  for (const path of paths) {
    if (!existsSync(path)) {
      continue;
    }
    const fromFile = readFileSync(path, 'utf8').trim();
    if (fromFile.length > 0) {
      return fromFile;
    }
  }
  return null;
};

export const createTokenFile = (
  paths: [string, ...string[]],
): TokenStorePort => {
  const [writePath] = paths;
  return {
    read: async (): Promise<Access | null> =>
      readSecret(paths) === null ? null : { kind: 'supervisor' },
    secret: async () => readSecret(paths),
    write: async (secret) => {
      mkdirSync(dirname(writePath), { recursive: true });
      writeFileSync(writePath, `${secret}\n`, { mode: TOKEN_MODE });
      chmodSync(writePath, TOKEN_MODE);
    },
    clear: async () => {
      rmSync(writePath, { force: true });
    },
  };
};
