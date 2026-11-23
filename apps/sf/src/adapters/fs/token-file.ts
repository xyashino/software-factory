import {
  chmodSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { TokenStorePort } from '../../application/ports/token-store.port';
import type { Connection } from '../../domain/connection/connection-config';
import type { Access } from '../../domain/access';
import {
  LEGACY_SUPERVISOR_TOKEN_PATH,
  OPERATOR_TOKEN_PATH,
} from '../../config';

const TOKEN_MODE = 0o600;

export const createTokenFile = (
  connection: Connection,
  repoTokenPath: string,
): TokenStorePort => ({
  read: async (): Promise<Access | null> =>
    connection.token === null ? null : { kind: 'operator' },
  secret: async () => connection.token,
  write: async (secret) => {
    mkdirSync(dirname(repoTokenPath), { recursive: true });
    writeFileSync(repoTokenPath, `${secret}\n`, { mode: TOKEN_MODE });
    chmodSync(repoTokenPath, TOKEN_MODE);
  },
  clear: async () => {
    rmSync(repoTokenPath, { force: true });
  },
});

export const repoTokenPathOf = (cwd: string): string =>
  !existsSync(resolve(cwd, OPERATOR_TOKEN_PATH)) &&
  existsSync(resolve(cwd, LEGACY_SUPERVISOR_TOKEN_PATH))
    ? LEGACY_SUPERVISOR_TOKEN_PATH
    : OPERATOR_TOKEN_PATH;
