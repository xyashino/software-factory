import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { TokenStorePort } from '../../application/ports/token-store.port';
import type { Connection } from '../../domain/connection/connection-config';
import type { Access } from '../../domain/access';

const TOKEN_MODE = 0o600;

export const createTokenFile = (
  connection: Connection,
  repoTokenPath: string,
): TokenStorePort => ({
  read: async (): Promise<Access | null> =>
    connection.token === null ? null : { kind: 'supervisor' },
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
