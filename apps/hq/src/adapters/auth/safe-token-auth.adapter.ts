import {
  TOKEN_SCOPES,
  type AuthPort,
  type Principal,
  type TokenScope,
} from '../../application/ports/auth.port';
import type { ClockPort } from '../../application/ports/clock.port';
import type { StoragePort } from '../../application/ports/storage.port';
import { hashToken } from '../../application/tokens/token-hash';
import { asFactoryId, asTokenId } from '../../domain/common/brand';
import { isExpired } from '../../domain/common/time';

const isTokenScope = (value: string): value is TokenScope =>
  TOKEN_SCOPES.some((scope) => scope === value);

export const createSafeTokenAuth = (
  storage: StoragePort,
  clock: ClockPort,
): AuthPort => ({
  verify: async (bearer) => {
    const row = await storage.read((tx) =>
      tx.tokens.findByHash(hashToken(bearer)),
    );
    if (row === undefined || row.revokedAt !== null) return null;
    if (row.expiresAt !== null && isExpired(row.expiresAt, clock.now()))
      return null;
    const principal: Principal = {
      tokenId: asTokenId(row.tokenId),
      name: row.name,
      factoryId: row.factoryId === null ? null : asFactoryId(row.factoryId),
      scopes: row.scopesJson.filter(isTokenScope),
    };
    return principal;
  },
});
