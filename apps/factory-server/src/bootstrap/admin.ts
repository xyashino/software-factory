import { immediateTx, type Db } from '../db/client';
import type { ClockPort } from '../application/ports/clock.port';
import {
  DEFAULT_SCOPES,
  insertSafeToken,
} from '../application/tokens/token-writes';

export const mintAdminToken = (db: Db, clock: ClockPort): string =>
  immediateTx(db, (tx) =>
    insertSafeToken(tx, {
      kind: 'supervisor',
      name: 'admin',
      scopes: DEFAULT_SCOPES.supervisor,
      cellId: null,
      rotatedFromId: null,
      expiresAt: null,
      now: clock.now(),
    }),
  ).token;
