import { basename, resolve } from 'node:path';
import { defineCommand } from 'citty';
import { buildContext } from '../../bootstrap/context';
import { runWithoutToken } from '../../bootstrap/run';
import {
  DEFAULT_DATA_DIR,
  DEFAULT_DB_PATH,
  DEFAULT_PORT,
  IS_COMPILED,
  LINES_DIR,
  REPO_CONFIG_PATH,
  serverArgsOf,
} from '../../config';
import {
  runSetup,
  type SetupResult,
} from '../../application/procedures/setup/setup.procedure';
import { EXIT } from '../../domain/exit-codes';
import { printJson, printLine, reportFailure } from './output';
import { parsePort } from './validate';

const NEXT_STEP = 'next: sf todos import --dry-run';

const printSteps = (result: SetupResult): void => {
  for (const step of result.steps) {
    printLine(`${step.step}: ${step.outcome}`);
  }
  printLine(NEXT_STEP);
};

const runSetupCommand = async (options: {
  cell: boolean;
  project: string | undefined;
  json: boolean;
}): Promise<number> => {
  const cwd = process.cwd();
  const port = parsePort(
    process.env.FACTORY_PORT ?? DEFAULT_PORT,
    'FACTORY_PORT',
  );
  const result = await runWithoutToken(
    runSetup,
    {
      repoRoot: cwd,
      dirName: basename(cwd),
      repoConfigPath: resolve(cwd, REPO_CONFIG_PATH),
      linesDir: resolve(cwd, LINES_DIR),
      dataDir: process.env.FACTORY_DATA_DIR ?? DEFAULT_DATA_DIR,
      dbPath: process.env.FACTORY_DB_PATH ?? DEFAULT_DB_PATH,
      port,
      host: process.env.FACTORY_HOST || undefined,
      bin: process.execPath,
      serverArgs: serverArgsOf(IS_COMPILED),
      project: options.project,
      cell: options.cell,
      reconnect: () => buildContext(),
    },
    () => buildContext(),
  );
  if (result.kind === 'ok') {
    if (options.json) {
      printJson(result.value);
    } else {
      printSteps(result.value);
    }
    return EXIT.ok;
  }
  return reportFailure(result);
};

export const setupCommand = defineCommand({
  meta: {
    name: 'setup',
    description:
      'Check, initialize, start the server and register this repo (idempotent)',
  },
  args: {
    cell: {
      type: 'boolean',
      default: false,
      description: 'Also scale this repo to one local Cell',
    },
    project: {
      type: 'string',
      description: 'Project id (default: git origin name or directory name)',
    },
    json: { type: 'boolean', default: false },
  },
  run: async ({ args }) => {
    process.exitCode = await runSetupCommand(args);
  },
});
