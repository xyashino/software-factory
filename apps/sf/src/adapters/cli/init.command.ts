import { basename } from 'node:path';
import { defineCommand } from 'citty';
import { buildContext } from '../../bootstrap/context';
import { runWithoutToken } from '../../bootstrap/run';
import {
  type InitResult,
  initProject,
} from '../../application/procedures/init/init.procedure';
import { printJson, printLine, reportFailure } from './output';

const printInit = (result: InitResult): void => {
  printLine(`initialized ${result.projectId}`);
  for (const path of result.written) {
    printLine(`  wrote ${path}`);
  }
  for (const path of result.skipped) {
    printLine(`  skip ${path}: exists, pass --force to overwrite`);
  }
  for (const entry of result.gitignoreUpdated) {
    printLine(`  gitignore + ${entry}`);
  }
};

const runInit = async (
  projectId: string | null,
  force: boolean,
  json: boolean,
): Promise<number> => {
  const root = process.cwd();
  const result = await runWithoutToken(
    initProject,
    { root, dirName: basename(root), projectId, force },
    () => buildContext(),
  );
  if (result.kind === 'ok') {
    if (json) {
      printJson(result.value);
    } else {
      printInit(result.value);
    }
  }
  return reportFailure(result);
};

export const initCommand = defineCommand({
  meta: {
    name: 'init',
    description: 'Write starter factory config into the current repo',
  },
  args: {
    project: {
      type: 'string',
      description: 'Project id (default: git origin name or directory name)',
    },
    force: {
      type: 'boolean',
      default: false,
      description: 'Overwrite existing starter files',
    },
    json: { type: 'boolean', default: false },
  },
  run: async ({ args }) => {
    process.exitCode = await runInit(
      args.project ?? null,
      args.force,
      args.json,
    );
  },
});
