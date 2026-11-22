import { basename, resolve } from 'node:path';
import { defineCommand } from 'citty';
import { buildContext } from '../../bootstrap/context';
import { runWithoutToken } from '../../bootstrap/run';
import {
  cellWorkerLauncherOf,
  DEFAULT_DATA_DIR,
  DEFAULT_DB_PATH,
  DEFAULT_PORT,
  IS_COMPILED,
  LINES_DIR,
  REPO_CONFIG_PATH,
  serverArgsOf,
} from '../../config';
import {
  type SetupResult,
  type SetupStep,
  setup,
} from '../../application/procedures/setup/setup.procedure';
import { EXIT } from '../../domain/exit-codes';
import { printJson, printLine, reportFailure } from './output';
import { parsePort } from './validate';

const NEXT_STEP_HINT = 'next: sf todos import --dry-run';

const stepLineOf = (step: SetupStep): string =>
  `${step.step} ${step.status}: ${step.detail}`;

const exitCodeOf = (result: SetupResult): number => {
  if (result.ok) {
    return EXIT.ok;
  }
  const doctorFailed = result.steps.some(
    (step) => step.step === 'doctor' && step.status === 'failed',
  );
  return doctorFailed ? EXIT.preflight : EXIT.refused;
};

const runSetup = async (
  cell: string | undefined,
  json: boolean,
): Promise<number> => {
  const cwd = process.cwd();
  const result = await runWithoutToken(
    setup,
    {
      cwd,
      dirName: basename(cwd),
      configPath: resolve(cwd, REPO_CONFIG_PATH),
      linesDir: resolve(cwd, LINES_DIR),
      dataDir: process.env.FACTORY_DATA_DIR ?? DEFAULT_DATA_DIR,
      dbPath: process.env.FACTORY_DB_PATH ?? DEFAULT_DB_PATH,
      bin: process.execPath,
      serverArgs: serverArgsOf(IS_COMPILED),
      port: parsePort(process.env.FACTORY_PORT ?? DEFAULT_PORT, 'FACTORY_PORT'),
      host: process.env.FACTORY_HOST || undefined,
      launcher: cellWorkerLauncherOf(IS_COMPILED, process.argv[1] ?? ''),
      cell,
    },
    () => buildContext(),
  );
  if (result.kind !== 'ok') {
    return reportFailure(result);
  }
  if (json) {
    printJson(result.value);
  } else {
    for (const step of result.value.steps) {
      printLine(stepLineOf(step));
    }
    if (result.value.ok) {
      printLine(NEXT_STEP_HINT);
    }
  }
  return exitCodeOf(result.value);
};

export const setupCommand = defineCommand({
  meta: {
    name: 'setup',
    description: 'Prepare this repo: doctor, init, server, project; idempotent',
  },
  args: {
    cell: {
      type: 'string',
      description: 'Also start a local Cell with this name',
    },
    json: { type: 'boolean', default: false },
  },
  run: async ({ args }) => {
    process.exitCode = await runSetup(args.cell, args.json);
  },
});
