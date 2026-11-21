import { REPO_CONFIG_PATH } from '../../../config';
import type { Access } from '../../../domain/access';
import { joinPath } from '../../../domain/common/path';
import { ArgumentError, Refused } from '../../core/errors';
import type { Ports } from '../../core/procedure';
import { readProjectId } from '../../core/repo-access';
import { listProjects } from '../projects/list-projects.procedure';
import { ensureWorkspace } from './workspace';

const SUPERVISOR: Access = { kind: 'supervisor' };

export interface ProjectSummary {
  projectId: string;
  repoUrl: string;
  defaultBaseBranch: string;
}

export type ProjectChooser = (
  projects: readonly ProjectSummary[],
) => Promise<ProjectSummary>;

export interface CellTarget {
  projectId: string;
  repoRoot: string;
}

export interface CellTargetInput {
  repoRoot: string;
  requested: string | undefined;
  choose: ProjectChooser | undefined;
}

interface PickInput {
  repoProject: string | null;
  projects: readonly ProjectSummary[];
  requested: string | undefined;
  choose: ProjectChooser | undefined;
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

const repoProjectOf = async (
  ctx: Ports,
  repoRoot: string,
): Promise<string | null> => {
  const configPath = joinPath(repoRoot, REPO_CONFIG_PATH);
  return (await ctx.fs.exists(configPath))
    ? readProjectId(ctx, configPath)
    : null;
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
  if (input.repoProject !== null) {
    if (
      input.requested !== undefined &&
      input.requested !== input.repoProject
    ) {
      throw new ArgumentError(
        `repo config selects project ${input.repoProject}, not --project ${input.requested}`,
      );
    }
    return findOrRefuse(input.projects, input.repoProject);
  }
  if (input.projects.length === 0) {
    throw new Refused(
      'no project registered on this Factory\nfix: sf project add <id> --repo <url>',
    );
  }
  if (input.requested !== undefined) {
    return findOrRefuse(input.projects, input.requested);
  }
  if (input.choose === undefined) {
    const ids = input.projects.map((project) => project.projectId).join(', ');
    throw new ArgumentError(
      `no repo config here, pass --project <id> (one of: ${ids})`,
    );
  }
  return input.choose(input.projects);
};

export const resolveCellTarget = async (
  ctx: Ports,
  input: CellTargetInput,
): Promise<CellTarget> => {
  const repoProject = await repoProjectOf(ctx, input.repoRoot);
  // Join-token-only workers cannot list projects; the repo config is trusted there.
  if (repoProject !== null && (await ctx.tokens.secret()) === null) {
    return { projectId: repoProject, repoRoot: input.repoRoot };
  }
  const project = await pickProject({
    repoProject,
    projects: await listedProjects(ctx),
    requested: input.requested,
    choose: input.choose,
  });
  if (repoProject !== null) {
    return { projectId: project.projectId, repoRoot: input.repoRoot };
  }
  return {
    projectId: project.projectId,
    repoRoot: await ensureWorkspace(ctx, project),
  };
};
