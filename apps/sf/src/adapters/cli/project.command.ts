import { basename, resolve } from 'node:path';
import { defineCommand } from 'citty';
import { buildContext } from '../../bootstrap/context';
import { run, runWithoutToken } from '../../bootstrap/run';
import { REPO_CONFIG_PATH } from '../../config';
import { addProject } from '../../application/procedures/projects/add-project.procedure';
import { listProjects } from '../../application/procedures/projects/list-projects.procedure';
import { resolveProjectDefaults } from '../../application/procedures/projects/resolve-project-defaults.procedure';
import {
  printError,
  printJson,
  printLine,
  printTable,
  reportFailure,
} from './output';
import { parseWholeNumber, requiredPositional } from './validate';

const DEFAULT_BASE_BRANCH = 'main';
const DEFAULT_MAX_RUNNING = '5';

interface AddInput {
  projectId: string | null;
  repoUrl: string | null;
  defaultBaseBranch: string;
  maxRunning: number;
}

const resolveAdd = (input: AddInput) => {
  const cwd = process.cwd();
  return runWithoutToken(
    resolveProjectDefaults,
    {
      projectId: input.projectId,
      repoUrl: input.repoUrl,
      cwd,
      configPath: resolve(cwd, REPO_CONFIG_PATH),
      dirName: basename(cwd),
    },
    () => buildContext(),
  );
};

const runAdd = async (input: AddInput, json: boolean): Promise<number> => {
  const resolved = await resolveAdd(input);
  if (resolved.kind === 'failed') {
    return reportFailure(resolved);
  }
  const { projectId, repoUrl, configuredId } = resolved.value;
  if (
    input.projectId !== null &&
    configuredId !== null &&
    configuredId !== projectId
  ) {
    printError(
      `warning: ${projectId} differs from ${REPO_CONFIG_PATH} project ${configuredId}`,
    );
  }
  const result = await run(
    addProject,
    {
      projectId,
      repoUrl,
      defaultBaseBranch: input.defaultBaseBranch,
      maxRunning: input.maxRunning,
    },
    'supervisor',
  );
  if (result.kind === 'ok') {
    if (json) {
      printJson(result.value);
    } else {
      const { project } = result.value;
      printLine(
        `project ${project.projectId} registered at ${project.repoUrl}`,
      );
    }
  }
  return reportFailure(result);
};

const runList = async (json: boolean): Promise<number> => {
  const result = await run(listProjects, {}, 'supervisor');
  if (result.kind === 'ok') {
    const { projects } = result.value;
    if (json) {
      printJson({ projects });
    } else {
      printTable(
        ['PROJECT', 'REPO', 'BASE', 'MAX_RUNNING'],
        projects.map((project) => [
          project.projectId,
          project.repoUrl,
          project.defaultBaseBranch,
          String(project.maxRunning),
        ]),
      );
    }
  }
  return reportFailure(result);
};

export const projectCommand = defineCommand({
  meta: {
    name: 'project',
    description: 'Register and list projects on the factory server',
  },
  subCommands: {
    add: defineCommand({
      meta: {
        name: 'add',
        description:
          'Register or update a project: sf project add [id] [--repo <url>]',
      },
      args: {
        id: {
          type: 'positional',
          required: false,
          description: `Project id (default: project in ${REPO_CONFIG_PATH}, else derived from origin)`,
        },
        repo: {
          type: 'string',
          required: false,
          description: 'Repo URL (default: origin remote)',
        },
        'base-branch': { type: 'string', default: DEFAULT_BASE_BRANCH },
        'max-running': { type: 'string', default: DEFAULT_MAX_RUNNING },
        json: { type: 'boolean', default: false },
      },
      run: async ({ args }) => {
        process.exitCode = await runAdd(
          {
            projectId:
              args.id === undefined
                ? null
                : requiredPositional(args.id, 'project id'),
            repoUrl: args.repo ?? null,
            defaultBaseBranch: args['base-branch'],
            maxRunning: parseWholeNumber(args['max-running'], '--max-running', {
              min: 1,
            }),
          },
          args.json,
        );
      },
    }),
    ls: defineCommand({
      meta: { name: 'ls', description: 'List projects on the factory server' },
      args: { json: { type: 'boolean', default: false } },
      run: async ({ args }) => {
        process.exitCode = await runList(args.json);
      },
    }),
  },
});
