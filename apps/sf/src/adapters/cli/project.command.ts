import { basename, join } from 'node:path';
import { defineCommand } from 'citty';
import { buildContext } from '../../bootstrap/context';
import { run, runWithoutToken } from '../../bootstrap/run';
import { REPO_CONFIG_PATH } from '../../config';
import { addProject } from '../../application/procedures/projects/add-project.procedure';
import { listProjects } from '../../application/procedures/projects/list-projects.procedure';
import { resolveAddDefaults } from '../../application/procedures/projects/resolve-add-defaults.procedure';
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
  projectId: string | undefined;
  repoUrl: string | undefined;
  defaultBaseBranch: string;
  maxRunning: number;
}

const runAdd = async (input: AddInput, json: boolean): Promise<number> => {
  const cwd = process.cwd();
  const defaults = await runWithoutToken(
    resolveAddDefaults,
    {
      configPath: join(cwd, REPO_CONFIG_PATH),
      cwd,
      dirName: basename(cwd),
      projectId: input.projectId ?? null,
      repoUrl: input.repoUrl ?? null,
    },
    () => buildContext(),
  );
  if (defaults.kind === 'failed') {
    return reportFailure(defaults);
  }
  if (defaults.value.warning !== null) {
    printError(defaults.value.warning);
  }
  const result = await run(
    addProject,
    {
      projectId: defaults.value.projectId,
      repoUrl: defaults.value.repoUrl,
      defaultBaseBranch: input.defaultBaseBranch,
      maxRunning: input.maxRunning,
    },
    'operator',
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
  const result = await run(listProjects, {}, 'operator');
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
    description: 'Register and list projects on HQ',
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
          description:
            'Project id (default: project in .factory/config.json, else from origin)',
        },
        repo: {
          type: 'string',
          description: 'Repo URL (default: git origin url)',
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
                ? undefined
                : requiredPositional(args.id, 'project id'),
            repoUrl: args.repo,
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
      meta: { name: 'ls', description: 'List projects on HQ' },
      args: { json: { type: 'boolean', default: false } },
      run: async ({ args }) => {
        process.exitCode = await runList(args.json);
      },
    }),
  },
});
