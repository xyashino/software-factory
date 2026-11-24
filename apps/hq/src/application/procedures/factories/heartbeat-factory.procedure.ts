import { heartbeatFactoryContract } from '@repo/hq-contracts/factories.contract';
import { factoryIdOf } from '../../core/identity';
import { scopedProcedure } from '../../core/procedure';

export const heartbeatFactoryProcedure = scopedProcedure(['factory:worker'])(
  heartbeatFactoryContract,
)(async (input, ctx) => {
  const factoryId = factoryIdOf(ctx);
  const now = ctx.clock.now();

  await ctx.storage.write(async (tx) => {
    await tx.factories.update(factoryId, {
      lastSeenAt: now,
      projectsJson: input.body.projects,
    });
  });

  return { code: 200 as const, factoryId };
});
