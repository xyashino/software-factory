import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { safeTokens } from '../../db/schema/tokens';
import {
  TOKEN_SCOPES,
  type AuthPort,
  type Principal,
  type TokenScope,
} from '../../application/ports/auth.port';
import type { ClockPort } from '../../application/ports/clock.port';
import { hashToken } from '../../application/tokens/token-hash';
import { asFactoryId, asTokenId } from '../../domain/common/brand';
import { isExpired } from '../../domain/common/time';

const isTokenScope = (value: string): value is TokenScope =>
  TOKEN_SCOPES.some((scope) => scope === value);

export const createSafeTokenAuth = (db: Db, clock: ClockPort): AuthPort => ({
  verify: (bearer) => {
    const row = db
      .select()
      .from(safeTokens)
      .where(eq(safeTokens.tokenHash, hashToken(bearer)))
      .get();
    if (row === undefined || row.revokedAt !== null)
      return Promise.resolve(null);
    if (row.expiresAt !== null && isExpired(row.expiresAt, clock.now()))
      return Promise.resolve(null);
    const principal: Principal = {
      tokenId: asTokenId(row.tokenId),
      factoryId: row.factoryId === null ? null : asFactoryId(row.factoryId),
      scopes: row.scopesJson.filter(isTokenScope),
    };
    return Promise.resolve(principal);
  },
});
