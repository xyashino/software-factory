import { listProjectsContract } from '@repo/hq-contracts/projects.contract';
import { scopedProcedure } from '../../core/procedure';

export const listProjectsProcedure = scopedProcedure(['supervisor:read'])(
  listProjectsContract,
)(async (_input, ctx) => ({
  code: 200 as const,
  projects: await ctx.storage.read((tx) => tx.projects.list()),
}));
