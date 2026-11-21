import { timingSafeEqual } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { WEB_SESSION_TTL_MS } from '../../../config';
import { joinTokenContract } from '../../../contracts/tokens.contract';
import { immediateTx } from '../../../db/client';
import { safeTokens } from '../../../db/schema/tokens';
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

export const joinTokenProcedure = publicProcedure(joinTokenContract)((
  input,
  ctx,
) => {
  if (!isLoopback(ctx.remoteAddress))
    throw new Forbidden('Join is only allowed from loopback');
  const now = ctx.clock.now();
  const issued = immediateTx(ctx.db, (tx) => {
    const join = tx
      .select()
      .from(safeTokens)
      .where(and(eq(safeTokens.kind, 'web_join'), isNull(safeTokens.revokedAt)))
      .get();
    if (
      join === undefined ||
      !matchesJoinSecret(join.tokenHash, input.body.joinSecret)
    )
      throw new Unauthorized('Invalid join secret');
    tx.update(safeTokens)
      .set({ revokedAt: now })
      .where(eq(safeTokens.tokenId, join.tokenId))
      .run();
    const expiresAt = now + WEB_SESSION_TTL_MS;
    const session = insertSafeToken(tx, {
      kind: 'web_session',
      name: 'web demo session',
      scopes: WEB_SESSION_SCOPES,
      cellId: null,
      rotatedFromId: null,
      expiresAt,
      now,
    });
    return { token: session.token, expiresAt };
  });
  return { code: 201 as const, ...issued };
});
