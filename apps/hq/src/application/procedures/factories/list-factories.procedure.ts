import { listFactoriesContract } from '@repo/hq-contracts/factories.contract';
import { isSilent } from '../../core/identity';
import { scopedProcedure } from '../../core/procedure';

export const listFactoriesProcedure = scopedProcedure(['supervisor:read'])(
  listFactoriesContract,
)(async (_input, ctx) => {
  const now = ctx.clock.now();
  const rows = await ctx.storage.read((tx) => tx.factories.list());
  return {
    code: 200 as const,
    factories: rows.map((row) => ({
      factoryId: row.factoryId,
      name: row.name,
      lastSeenAt: row.lastSeenAt,
      online: !isSilent(row.lastSeenAt, now),
      projects: row.projectsJson,
    })),
  };
});
