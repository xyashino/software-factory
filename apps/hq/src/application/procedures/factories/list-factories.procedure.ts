import { listFactoriesContract } from '@repo/hq-contracts/factories.contract';
import { factories } from '../../../db/schema/factories';
import { isSilent } from '../../core/identity';
import { scopedProcedure } from '../../core/procedure';

export const listFactoriesProcedure = scopedProcedure(['supervisor:read'])(
  listFactoriesContract,
)((_input, ctx) => {
  const now = ctx.clock.now();
  const rows = ctx.db.select().from(factories).all();
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
