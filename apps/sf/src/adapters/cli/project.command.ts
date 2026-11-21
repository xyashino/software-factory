import { defineCommand } from 'citty';
import { run } from '../../bootstrap/run';
import { addProject } from '../../application/procedures/projects/add-project.procedure';
import { listProjects } from '../../application/procedures/projects/list-projects.procedure';
import { printJson, printLine, printTable, reportFailure } from './output';
import { parseWholeNumber, requiredPositional } from './validate';

const DEFAULT_BASE_BRANCH = 'main';
const DEFAULT_MAX_RUNNING = '5';

const runAdd = async (
  input: {
    projectId: string;
    repoUrl: string;
    defaultBaseBranch: string;
    maxRunning: number;
  },
  json: boolean,
): Promise<number> => {
  const result = await run(addProject, input, 'supervisor');
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
        description: 'Register or update a project: sf project add <id>',
      },
      args: {
        id: { type: 'positional', required: true, description: 'Project id' },
        repo: { type: 'string', required: true, description: 'Repo URL' },
        'base-branch': { type: 'string', default: DEFAULT_BASE_BRANCH },
        'max-running': { type: 'string', default: DEFAULT_MAX_RUNNING },
        json: { type: 'boolean', default: false },
      },
      run: async ({ args }) => {
        process.exitCode = await runAdd(
          {
            projectId: requiredPositional(args.id, 'project id'),
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
      meta: { name: 'ls', description: 'List projects on the factory server' },
      args: { json: { type: 'boolean', default: false } },
      run: async ({ args }) => {
        process.exitCode = await runList(args.json);
      },
    }),
  },
});
