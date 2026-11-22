import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { and, eq, isNull } from 'drizzle-orm';
import type { ClockPort } from '../application/ports/clock.port';
import { insertSafeToken } from '../application/tokens/token-writes';
import { immediateTx, type Db } from '../db/client';
import { safeTokens } from '../db/schema/tokens';

const WEB_JOIN_FILE = 'web-demo.join';
const JOIN_FILE_MODE = 0o600;

export const writeWebJoinFile = (
  db: Db,
  clock: ClockPort,
  dataDir: string,
): void => {
  const secret = immediateTx(db, (tx) => {
    tx.update(safeTokens)
      .set({ revokedAt: clock.now() })
      .where(and(eq(safeTokens.kind, 'web_join'), isNull(safeTokens.revokedAt)))
      .run();
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
