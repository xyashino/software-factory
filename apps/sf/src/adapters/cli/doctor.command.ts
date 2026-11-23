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
  runDoctor,
  type DoctorCheck,
} from '../../application/procedures/doctor/doctor.procedure';
import { hqSettingOf } from '../../bootstrap/hq-env';
import { EXIT } from '../../domain/exit-codes';
import { printJson, printLine, reportFailure } from './output';

const formatCheck = (item: DoctorCheck): string =>
  item.fix === undefined
    ? `${item.status}: ${item.detail}`
    : `${item.status}: ${item.detail}; fix: ${item.fix}`;

const runDiagnose = async (json: boolean): Promise<number> => {
  const cwd = process.cwd();
  const result = await runWithoutToken(
    runDoctor,
    {
      repoRoot: cwd,
      repoConfigPath: resolve(cwd, REPO_CONFIG_PATH),
      linesDir: resolve(cwd, LINES_DIR),
      dataDir: hqSettingOf('DATA_DIR') ?? DEFAULT_DATA_DIR,
      dbPath: hqSettingOf('DB_PATH') ?? DEFAULT_DB_PATH,
    },
    () => buildContext(),
  );
  if (result.kind !== 'ok') {
    return reportFailure(result);
  }
  if (json) {
    printJson(result.value);
  } else {
    for (const item of result.value.checks) {
      printLine(formatCheck(item));
    }
  }
  return result.value.ok ? EXIT.ok : EXIT.refused;
};

export const doctorCommand = defineCommand({
  meta: {
    name: 'doctor',
    description: 'Check this machine for missing or broken setup',
  },
  args: {
    json: { type: 'boolean', default: false },
  },
  run: async ({ args }) => {
    process.exitCode = await runDiagnose(args.json);
  },
});
