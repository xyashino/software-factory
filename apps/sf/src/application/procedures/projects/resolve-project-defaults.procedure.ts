import { z } from 'zod';
import { defaultProjectId } from '../../../domain/init/project-id';
import { ArgumentError } from '../../core/errors';
import { define } from '../../core/procedure';
import { readProjectId } from '../../core/repo-access';

const ResolveSchema = z
  .object({
    projectId: z.string().nullable(),
    repoUrl: z.string().nullable(),
    cwd: z.string().min(1),
    configPath: z.string().min(1),
    dirName: z.string(),
  })
  .strict();

export interface ResolvedProject {
  projectId: string;
  repoUrl: string;
  configuredId: string | null;
}

export const resolveProjectDefaults = define({ kind: 'supervisor' })(
  ResolveSchema,
)<ResolvedProject>(async (input, ctx) => {
  const origin = await ctx.git.originUrl(input.cwd);
  const repoUrl = input.repoUrl ?? origin;
  if (repoUrl === null) {
    throw new ArgumentError('no origin remote, pass --repo <url>');
  }
  const configuredId = (await ctx.fs.exists(input.configPath))
    ? await readProjectId(ctx, input.configPath)
    : null;
  const projectId =
    input.projectId ?? configuredId ?? defaultProjectId(origin, input.dirName);
  if (projectId === '') {
    throw new ArgumentError('cannot derive a project id, pass a project id');
  }
  return { projectId, repoUrl, configuredId };
});
