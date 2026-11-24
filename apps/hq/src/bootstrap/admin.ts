import type { ClockPort } from '../application/ports/clock.port';
import type { StoragePort } from '../application/ports/storage.port';
import {
  DEFAULT_SCOPES,
  insertSafeToken,
} from '../application/tokens/token-writes';

export const mintAdminToken = async (
  storage: StoragePort,
  clock: ClockPort,
): Promise<string> =>
  (
    await storage.write((tx) =>
      insertSafeToken(tx, {
        kind: 'supervisor',
        name: 'admin',
        scopes: DEFAULT_SCOPES.supervisor,
        rotatedFromId: null,
        expiresAt: null,
        now: clock.now(),
      }),
    )
  ).token;
