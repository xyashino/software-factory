import {
  listProjectsContract,
  projectDto,
} from '@repo/hq-contracts/projects.contract';
import { z } from 'zod';
import { define } from '../../core/procedure';
import { readSecret } from '../../core/repo-access';

const PROJECTS_ROUTE = '/api/v1/projects';

const ListSchema = z.object({}).strict();

export interface ListProjectsResult {
  projects: z.infer<typeof projectDto>[];
}

export const listProjects = define({ kind: 'supervisor' })(
  ListSchema,
)<ListProjectsResult>(async (_input, ctx) => {
  const secret = await readSecret(ctx);
  const reply = listProjectsContract.out[200].parse(
    await ctx.hq.get(PROJECTS_ROUTE, {}, secret),
  );
  return { projects: reply.projects };
});
