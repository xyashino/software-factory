import { z } from 'zod';
import { REPO_CONFIG_PATH } from '../../../config';
import { defaultProjectId } from '../../../domain/init/project-id';
import { ArgumentError } from '../../core/errors';
import { define } from '../../core/procedure';
import { readProjectId } from '../../core/repo-access';

const ResolveSchema = z
  .object({
    configPath: z.string().min(1),
    cwd: z.string().min(1),
    dirName: z.string(),
    projectId: z.string().nullable(),
    repoUrl: z.string().nullable(),
  })
  .strict();

export interface AddDefaults {
  projectId: string;
  repoUrl: string;
  warning: string | null;
}

export const resolveAddDefaults = define({ kind: 'supervisor' })(
  ResolveSchema,
)<AddDefaults>(async (input, ctx) => {
  const configured = (await ctx.fs.exists(input.configPath))
    ? await readProjectId(ctx, input.configPath)
    : null;
  const origin = await ctx.git.originUrl(input.cwd);
  const repoUrl = input.repoUrl ?? origin;
  const projectId =
    input.projectId ??
    configured ??
    (origin === null ? null : defaultProjectId(origin, input.dirName));
  if (projectId === null) {
    throw new ArgumentError(
      `no project id: pass <id> or run inside a repo with ${REPO_CONFIG_PATH}`,
    );
  }
  if (repoUrl === null) {
    throw new ArgumentError('no origin remote: pass --repo <url>');
  }
  const mismatch =
    input.projectId !== null &&
    configured !== null &&
    input.projectId !== configured;
  return {
    projectId,
    repoUrl,
    warning: mismatch
      ? `warning: ${input.projectId} differs from ${REPO_CONFIG_PATH} project ${configured}`
      : null,
  };
});
