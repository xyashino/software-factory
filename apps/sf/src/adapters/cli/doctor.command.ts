import { resolve } from 'node:path';
import { defineCommand } from 'citty';
import { buildContext } from '../../bootstrap/context';
import { runWithoutToken } from '../../bootstrap/run';
import {
  DEFAULT_DATA_DIR,
  DEFAULT_DB_PATH,
  LINES_DIR,
  REPO_CONFIG_PATH,
} from '../../config';
import {
  doctor,
  type DoctorCheck,
  type DoctorResult,
} from '../../application/procedures/doctor/doctor.procedure';
import { EXIT } from '../../domain/exit-codes';
import { printJson, printLine, reportFailure } from './output';

const checkLineOf = (check: DoctorCheck): string => {
  const detail = check.detail ? `: ${check.detail}` : '';
  const fix = check.fix ? `; fix: ${check.fix}` : '';
  return `${check.status}: ${check.name}${detail}${fix}`;
};

const printResult = (result: DoctorResult, json: boolean): void => {
  if (json) {
    printJson(result);
    return;
  }
  for (const check of result.checks) {
    printLine(checkLineOf(check));
  }
};

const runDoctor = async (json: boolean): Promise<number> => {
  const cwd = process.cwd();
  const result = await runWithoutToken(
    doctor,
    {
      cwd,
      linesDir: resolve(cwd, LINES_DIR),
      configPath: resolve(cwd, REPO_CONFIG_PATH),
      dataDir: process.env.FACTORY_DATA_DIR ?? DEFAULT_DATA_DIR,
      dbPath: process.env.FACTORY_DB_PATH ?? DEFAULT_DB_PATH,
    },
    () => buildContext(),
  );
  if (result.kind === 'ok') {
    printResult(result.value, json);
    return result.value.ok ? EXIT.ok : EXIT.preflight;
  }
  return reportFailure(result);
};

export const doctorCommand = defineCommand({
  meta: {
    name: 'doctor',
    description: 'Check this machine is ready before server, Cell or jobs run',
  },
  args: {
    json: { type: 'boolean', default: false },
  },
  run: async ({ args }) => {
    process.exitCode = await runDoctor(args.json);
  },
});
