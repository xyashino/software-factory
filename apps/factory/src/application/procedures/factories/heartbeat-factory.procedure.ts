import { eq } from 'drizzle-orm';
import { heartbeatFactoryContract } from '@repo/factory-contracts/factories.contract';
import { immediateTx } from '../../../db/client';
import { factories } from '../../../db/schema/factories';
import { safeTokens } from '../../../db/schema/tokens';
import { Forbidden } from '../../core/error-handling';
import { scopedProcedure } from '../../core/procedure';

export const heartbeatFactoryProcedure = scopedProcedure(['factory:worker'])(
  heartbeatFactoryContract,
)((_input, ctx) => {
  const now = ctx.clock.now();

  const factoryId = immediateTx(ctx.db, (tx) => {
    const token = tx
      .select()
      .from(safeTokens)
      .where(eq(safeTokens.tokenId, ctx.principal.tokenId))
      .get();
    if (token === undefined || token.factoryId === null)
      throw new Forbidden('Token is not bound to a factory');
    tx.update(factories)
      .set({ lastSeenAt: now })
      .where(eq(factories.factoryId, token.factoryId))
      .run();
    return token.factoryId;
  });

  return { code: 200 as const, factoryId };
});
