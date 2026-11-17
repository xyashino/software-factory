import { basename } from 'node:path';
import type { FactoryClient } from '@repo/factory-core/contracts/client';
import type { ProjectId } from '@repo/factory-core/ids';
import { repoProjectId } from '@repo/factory-core/repo-project';
import type { RunGit } from './ports';

/** The project this Cell's repository runs as, and the projects the Cell serves with it. */
export interface RepoProject {
  projectId: ProjectId;
  /** The configured projects, with the repository's project first when it is not already listed. */
  projects: ProjectId[];
}

/**
 * The repository's `origin` url (`git remote get-url origin`). A repository with no origin cannot
 * register its project, so the Cell refuses to start in it.
 */
export const originUrlOf = async (
  runGit: RunGit,
  repoRoot: string,
): Promise<string> => {
  const result = await runGit(repoRoot, ['remote', 'get-url', 'origin']);
  const url = result.stdout.trim();
  if (result.code !== 0 || url === '') {
    throw new Error(
      `repository ${repoRoot} has no origin remote; factory-cell registers the repository's project from origin`,
    );
  }
  return url;
};

/**
 * Makes sure the repository's project is registered on the Factory, then returns the
 * projects this Cell serves. Registration is idempotent: a project the Factory already has keeps its
 * settings, and only a missing one is added, with its repo url from origin.
 */
export const ensureRepoProject = async (options: {
  client: FactoryClient;
  runGit: RunGit;
  repoRoot: string;
  configured: readonly ProjectId[];
  log: (line: string) => void;
}): Promise<RepoProject> => {
  const projectId = repoProjectId(
    basename(options.repoRoot),
    options.configured,
  );
  const repoUrl = await originUrlOf(options.runGit, options.repoRoot);
  const { project, created } = await options.client.call('cellProjectEnsure', {
    projectId,
    repoUrl,
  });
  options.log(
    created
      ? `factory-cell: registered project ${projectId} from ${repoUrl}`
      : `factory-cell: project ${projectId} is already registered`,
  );
  if (!created && project.repoUrl !== repoUrl) {
    options.log(
      `factory-cell: project ${projectId} keeps its registered repo ${project.repoUrl}; origin is ${repoUrl}`,
    );
  }
  const projects = options.configured.includes(projectId)
    ? [...options.configured]
    : [projectId, ...options.configured];
  return { projectId, projects };
};
