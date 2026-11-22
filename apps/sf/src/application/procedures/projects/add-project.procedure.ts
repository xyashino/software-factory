import {
  projectDto,
  upsertProjectContract,
} from '@repo/factory-contracts/projects.contract';
import { slugSchema } from '@repo/zod-contract-kit/fields';
import { z } from 'zod';
import { define } from '../../core/procedure';
import { readSecret } from '../../core/repo-access';

const PROJECTS_ROUTE = '/api/v1/projects';

const AddSchema = z
  .object({
    projectId: slugSchema,
    repoUrl: z.string().trim().min(1),
    defaultBaseBranch: z.string().trim().min(1),
    maxRunning: z.number().int().min(1),
  })
  .strict();

const ProjectReplySchema = z.union([
  upsertProjectContract.out[200],
  upsertProjectContract.out[201],
]);

export interface AddProjectResult {
  project: z.infer<typeof projectDto>;
}

export const addProject = define({ kind: 'supervisor' })(
  AddSchema,
)<AddProjectResult>(async (input, ctx) => {
  const secret = await readSecret(ctx);
  const reply = ProjectReplySchema.parse(
    await ctx.server.call(PROJECTS_ROUTE, input, secret),
  );
  return { project: reply.project };
});
