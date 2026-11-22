import { z } from 'zod';
import { REPO_CONFIG_PATH } from '../../../config';
import { joinPath, parentPath } from '../../../domain/common/path';
import { Refused } from '../../core/errors';
import { define, type Ports } from '../../core/procedure';
import { readProjectId } from '../../core/repo-access';
import { listProjects } from '../projects/list-projects.procedure';
import { scaleFactoryCells } from './factory-cells';

const ScaleInputSchema = z
  .object({
    cwd: z.string().min(1),
    count: z.number().int().min(0),
    lines: z.array(z.string().min(1)).min(1).optional(),
  })
  .strict();

const NOT_A_REPO = 'not inside a repo with .factory/config.json';

export interface ScaleResult {
  projectId: string;
  repoRoot: string;
  count: number;
}

const repoRootOf = async (ctx: Ports, cwd: string): Promise<string> => {
  let dir = cwd;
  while (!(await ctx.fs.exists(joinPath(dir, REPO_CONFIG_PATH)))) {
    const parent = parentPath(dir);
    if (parent === dir) {
      throw new Refused(NOT_A_REPO);
    }
    dir = parent;
  }
  return dir;
};

export const scaleCells = define({ kind: 'supervisor' })(
  ScaleInputSchema,
)<ScaleResult>(async (input, ctx) => {
  const repoRoot = await repoRootOf(ctx, input.cwd);
  const projectId = await readProjectId(
    ctx,
    joinPath(repoRoot, REPO_CONFIG_PATH),
  );
  const { projects } = await listProjects.execute({}, ctx);
  if (!projects.some((project) => project.projectId === projectId)) {
    throw new Refused(
      `project ${projectId} is not registered on this Factory\nfix: sf project add ${projectId} --repo <url>`,
    );
  }
  await scaleFactoryCells.execute(
    { repoRoot, projectId, lines: input.lines, count: input.count },
    ctx,
  );
  return { projectId, repoRoot, count: input.count };
});
