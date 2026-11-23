import { asc } from 'drizzle-orm';
import { projects } from '../../../db/schema/projects';
import { listProjectsContract } from '@repo/hq-contracts/projects.contract';
import { scopedProcedure } from '../../core/procedure';

export const listProjectsProcedure = scopedProcedure(['operator:read'])(
  listProjectsContract,
)((_input, ctx) => ({
  code: 200 as const,
  projects: ctx.db
    .select()
    .from(projects)
    .orderBy(asc(projects.projectId))
    .all(),
}));
