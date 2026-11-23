import { REPO_CONFIG_PATH } from '../../../config';
import { joinPath } from '../../../domain/common/path';
import { ArgumentError } from '../../core/errors';
import type { Ports } from '../../core/procedure';
import { readProjectId } from '../../core/repo-access';

export interface CellTarget {
  projectId: string;
  repoRoot: string;
}

export const resolveCellTarget = async (
  ctx: Ports,
  repoRoot: string,
): Promise<CellTarget> => {
  const configPath = joinPath(repoRoot, REPO_CONFIG_PATH);
  if (!(await ctx.fs.exists(configPath))) {
    throw new ArgumentError(
      `${REPO_CONFIG_PATH} not found in ${repoRoot}, a Cell starts only inside a project repo`,
    );
  }
  return { projectId: await readProjectId(ctx, configPath), repoRoot };
};
