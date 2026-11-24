import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ClockPort } from '../application/ports/clock.port';
import type { StoragePort } from '../application/ports/storage.port';
import { insertSafeToken } from '../application/tokens/token-writes';

const WEB_JOIN_FILE = 'web-demo.join';
const JOIN_FILE_MODE = 0o600;

export const writeWebJoinFile = async (
  storage: StoragePort,
  clock: ClockPort,
  dataDir: string,
): Promise<void> => {
  const secret = await storage.write((tx) => {
    tx.tokens.revokeActiveOfKind('web_join', clock.now());
    return insertSafeToken(tx, {
      kind: 'web_join',
      name: 'web-demo join',
      scopes: [],
      rotatedFromId: null,
      expiresAt: null,
      now: clock.now(),
    }).token;
  });
  const path = join(dataDir, WEB_JOIN_FILE);
  writeFileSync(path, secret, { mode: JOIN_FILE_MODE });
  chmodSync(path, JOIN_FILE_MODE);
};
