import { timingSafeEqual } from 'node:crypto';
import { WEB_SESSION_TTL_MS } from '../../../config';
import { joinTokenContract } from '@repo/hq-contracts/tokens.contract';
import { WEB_SESSION_SCOPES } from '../../../domain/tokens/web-session';
import { Forbidden, Unauthorized } from '../../core/error-handling';
import { publicProcedure } from '../../core/procedure';
import { hashToken } from '../../tokens/token-hash';
import { insertSafeToken } from '../../tokens/token-writes';

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

const isLoopback = (address: string | null): boolean =>
  address !== null && LOOPBACK_ADDRESSES.has(address);

const matchesJoinSecret = (storedHash: string, secret: string): boolean =>
  timingSafeEqual(Buffer.from(storedHash), Buffer.from(hashToken(secret)));

export const joinTokenProcedure = publicProcedure(joinTokenContract)(async (
  input,
  ctx,
) => {
  if (!isLoopback(ctx.remoteAddress))
    throw new Forbidden('Join is only allowed from loopback');
  const now = ctx.clock.now();
  const issued = await ctx.storage.write((tx) => {
    const join = tx.tokens.findActiveJoin();
    if (
      join === undefined ||
      !matchesJoinSecret(join.tokenHash, input.body.joinSecret)
    )
      throw new Unauthorized('Invalid join secret');
    tx.tokens.update(join.tokenId, { revokedAt: now });
    const expiresAt = now + WEB_SESSION_TTL_MS;
    const session = insertSafeToken(tx, {
      kind: 'web_session',
      name: 'web demo session',
      scopes: WEB_SESSION_SCOPES,
      rotatedFromId: null,
      expiresAt,
      now,
    });
    return { token: session.token, expiresAt };
  });
  return { code: 201 as const, ...issued };
});
