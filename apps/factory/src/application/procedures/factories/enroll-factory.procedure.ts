import { eq } from 'drizzle-orm';
import { FACTORY_SESSION_TTL_MS } from '../../../config';
import { enrollFactoryContract } from '@repo/factory-contracts/factories.contract';
import { immediateTx } from '../../../db/client';
import { factories } from '../../../db/schema/factories';
import { safeTokens } from '../../../db/schema/tokens';
import { asFactoryId } from '../../../domain/common/brand';
import { addMs } from '../../../domain/common/time';
import { Unauthorized } from '../../core/error-handling';
import { scopedProcedure } from '../../core/procedure';
import { insertSafeToken } from '../../tokens/token-writes';

export const enrollFactoryProcedure = scopedProcedure(['factory:enroll'])(
  enrollFactoryContract,
)((input, ctx) => {
  const now = ctx.clock.now();
  const factoryId = asFactoryId(crypto.randomUUID());
  const expiresAt = addMs(now, FACTORY_SESSION_TTL_MS);

  const session = immediateTx(ctx.db, (tx) => {
    const join = tx
      .select()
      .from(safeTokens)
      .where(eq(safeTokens.tokenId, ctx.principal.tokenId))
      .get();
    if (join === undefined || join.revokedAt !== null)
      throw new Unauthorized('Join token already used');
    tx.update(safeTokens)
      .set({ revokedAt: now })
      .where(eq(safeTokens.tokenId, join.tokenId))
      .run();
    tx.insert(factories)
      .values({
        factoryId,
        name: input.body.name,
        lastSeenAt: now,
        createdAt: now,
      })
      .run();
    return insertSafeToken(tx, {
      kind: 'factory_session',
      name: `${input.body.name} session`,
      scopes: ['factory:worker'],
      cellId: null,
      factoryId,
      rotatedFromId: null,
      expiresAt,
      now,
    });
  });

  return {
    code: 201 as const,
    factoryId,
    sessionToken: session.token,
    expiresAt,
  };
});
