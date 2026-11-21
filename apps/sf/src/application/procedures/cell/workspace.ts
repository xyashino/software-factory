import { LINES_DIR, REPO_CONFIG_PATH, WORKSPACES_DIR } from '../../../config';
import { joinPath } from '../../../domain/common/path';
import { ArgumentError, Refused } from '../../core/errors';
import type { Ports } from '../../core/procedure';
import { readProjectId } from '../../core/repo-access';
import type { ProjectSummary } from './resolve-project-target';

const LINE_SUFFIX = '.yml';

const workspaceDirOf = (projectId: string): string =>
  joinPath(WORKSPACES_DIR, projectId);

const verifyReusable = async (
  ctx: Ports,
  dir: string,
  repoUrl: string,
): Promise<void> => {
  if ((await ctx.git.originUrl(dir)) !== repoUrl) {
    throw new Refused(`workspace ${dir} is not a clone of ${repoUrl}`);
  }
  if (!(await ctx.git.isClean(dir))) {
    throw new Refused(`workspace ${dir} has uncommitted changes`);
  }
};

const hasLineFiles = async (ctx: Ports, dir: string): Promise<boolean> =>
  (await ctx.fs.list(joinPath(dir, LINES_DIR))).some((name) =>
    name.endsWith(LINE_SUFFIX),
  );

export const ensureWorkspace = async (
  ctx: Ports,
  project: ProjectSummary,
): Promise<string> => {
  const dir = workspaceDirOf(project.projectId);
  if (await ctx.fs.exists(joinPath(dir, '.git'))) {
    await verifyReusable(ctx, dir, project.repoUrl);
  } else if (await ctx.fs.exists(dir)) {
    throw new Refused(`workspace ${dir} exists but is not a git clone`);
  } else {
    await ctx.git.clone(project.repoUrl, dir);
  }
  if (!(await hasLineFiles(ctx, dir))) {
    throw new ArgumentError(
      `no line files in ${LINES_DIR} of project ${project.projectId}`,
    );
  }
  await readProjectId(ctx, joinPath(dir, REPO_CONFIG_PATH));
  return dir;
};
