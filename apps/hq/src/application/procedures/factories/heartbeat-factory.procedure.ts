import { eq } from 'drizzle-orm';
import { heartbeatFactoryContract } from '@repo/hq-contracts/factories.contract';
import { immediateTx } from '../../../db/client';
import { factories } from '../../../db/schema/factories';
import { factoryIdOf } from '../../core/identity';
import { scopedProcedure } from '../../core/procedure';

export const heartbeatFactoryProcedure = scopedProcedure(['factory:worker'])(
  heartbeatFactoryContract,
)((input, ctx) => {
  const factoryId = factoryIdOf(ctx);
  const now = ctx.clock.now();

  immediateTx(ctx.db, (tx) => {
    tx.update(factories)
      .set({ lastSeenAt: now, projectsJson: input.body.projects })
      .where(eq(factories.factoryId, factoryId))
      .run();
  });

  return { code: 200 as const, factoryId };
});
