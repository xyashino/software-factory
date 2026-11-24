import { FACTORY_SESSION_TTL_MS } from '../../../config';
import { enrollFactoryContract } from '@repo/hq-contracts/factories.contract';
import { asFactoryId } from '../../../domain/common/brand';
import { addMs } from '../../../domain/common/time';
import { Unauthorized } from '../../core/error-handling';
import { scopedProcedure } from '../../core/procedure';
import { insertSafeToken } from '../../tokens/token-writes';

export const enrollFactoryProcedure = scopedProcedure(['factory:enroll'])(
  enrollFactoryContract,
)(async (input, ctx) => {
  const now = ctx.clock.now();
  const factoryId = asFactoryId(crypto.randomUUID());
  const expiresAt = addMs(now, FACTORY_SESSION_TTL_MS);

  const session = await ctx.storage.write(async (tx) => {
    const join = await tx.tokens.find(ctx.principal.tokenId);
    if (join === undefined || join.revokedAt !== null)
      throw new Unauthorized('Join token already used');
    await tx.tokens.update(join.tokenId, { revokedAt: now });
    await tx.factories.insert({
      factoryId,
      name: input.body.name,
      lastSeenAt: now,
      createdAt: now,
    });
    return insertSafeToken(tx, {
      kind: 'factory_session',
      name: `${input.body.name} session`,
      scopes: ['factory:worker'],
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
