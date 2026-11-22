import { REPO_CONFIG_PATH } from '../../../config';
import type { Access } from '../../../domain/access';
import { joinPath } from '../../../domain/common/path';
import { ArgumentError, Refused } from '../../core/errors';
import type { Ports } from '../../core/procedure';
import { readProjectId } from '../../core/repo-access';
import { listProjects } from '../projects/list-projects.procedure';

const SUPERVISOR: Access = { kind: 'supervisor' };
const NOT_A_REPO = 'not inside a repo with .factory/config.json';

export interface ProjectSummary {
  projectId: string;
  repoUrl: string;
  defaultBaseBranch: string;
}

export interface CellTarget {
  projectId: string;
  repoRoot: string;
}

export interface CellTargetInput {
  repoRoot: string;
  requested: string | undefined;
  relayed: boolean;
}

interface PickInput {
  repoProject: string;
  projects: readonly ProjectSummary[];
  requested: string | undefined;
}

const findOrRefuse = (
  projects: readonly ProjectSummary[],
  projectId: string,
): ProjectSummary => {
  const project = projects.find((item) => item.projectId === projectId);
  if (project === undefined) {
    throw new Refused(
      `project ${projectId} is not registered on this Factory\nfix: sf project add ${projectId} --repo <url>`,
    );
  }
  return project;
};

const listedProjects = async (ctx: Ports): Promise<ProjectSummary[]> =>
  (
    await listProjects.execute(
      {},
      { ...ctx, token: SUPERVISOR, principal: SUPERVISOR },
    )
  ).projects;

export const pickProject = async (
  input: PickInput,
): Promise<ProjectSummary> => {
  if (input.requested !== undefined && input.requested !== input.repoProject) {
    throw new ArgumentError(
      `repo config selects project ${input.repoProject}, not --project ${input.requested}`,
    );
  }
  return findOrRefuse(input.projects, input.repoProject);
};

export const resolveCellTarget = async (
  ctx: Ports,
  input: CellTargetInput,
): Promise<CellTarget> => {
  const configPath = joinPath(input.repoRoot, REPO_CONFIG_PATH);
  if (!(await ctx.fs.exists(configPath))) {
    throw new Refused(NOT_A_REPO);
  }
  const repoProject = await readProjectId(ctx, configPath);
  // Join-token-only and relayed workers cannot list projects; the repo config is trusted there.
  const trustsRepo = input.relayed || (await ctx.tokens.secret()) === null;
  if (trustsRepo) {
    return { projectId: repoProject, repoRoot: input.repoRoot };
  }
  const project = await pickProject({
    repoProject,
    projects: await listedProjects(ctx),
    requested: input.requested,
  });
  return { projectId: project.projectId, repoRoot: input.repoRoot };
};
