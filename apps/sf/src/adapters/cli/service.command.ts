import { join, resolve } from 'node:path';
import { defineCommand } from 'citty';
import {
  CELL_LINES_ENV,
  DEFAULT_DATA_DIR,
  DEFAULT_DB_PATH,
  DEFAULT_PORT,
  IS_COMPILED,
  JOIN_TOKEN_ENV,
  SYSTEMD_USER_DIR,
  cellWorkerLauncherOf,
  serverArgsOf,
} from '../../config';
import { hqSettingOf } from '../../bootstrap/hq-env';
import { Refused } from '../../application/core/errors';
import { cellNameOf } from '../../domain/cell/cell-name';
import {
  SERVER_UNIT_NAME,
  UNIT_SUFFIX,
  cellNameOfUnit,
  cellUnitNameOf,
  cellUnitOf,
  serverUnitOf,
} from '../../domain/service/units';
import {
  isUnitTaken,
  listUnitFiles,
  readUnitIfManaged,
  removeFileIfExists,
  writeSecretEnvFile,
  writeUnitFile,
} from '../fs/service-units';
import { printLine } from './output';
import { parsePort } from './validate';

const SERVICE_DIR_NAME = 'service';
const ENV_SUFFIX = '.env';

interface Plan {
  unitName: string;
  text: string;
  secret?: { path: string; text: string };
}

const dataDirOf = (): string => hqSettingOf('DATA_DIR') ?? DEFAULT_DATA_DIR;

const unitPathOf = (unitName: string): string =>
  join(SYSTEMD_USER_DIR, unitName);

const envFileOf = (unitName: string): string =>
  join(
    dataDirOf(),
    SERVICE_DIR_NAME,
    `${unitName.slice(0, -UNIT_SUFFIX.length)}${ENV_SUFFIX}`,
  );

const serverEnvOf = (): Record<string, string> => {
  const env: Record<string, string> = {
    HQ_DATA_DIR: dataDirOf(),
    HQ_DB_PATH: hqSettingOf('DB_PATH') ?? DEFAULT_DB_PATH,
    HQ_PORT: String(parsePort(hqSettingOf('PORT') ?? DEFAULT_PORT, 'HQ_PORT')),
  };
  const host = hqSettingOf('HOST');
  if (host !== undefined) {
    env.HQ_HOST = host;
  }
  return env;
};

const serverPlanOf = (): Plan => ({
  unitName: SERVER_UNIT_NAME,
  text: serverUnitOf({
    execArgs: [process.execPath, ...serverArgsOf(IS_COMPILED)],
    env: serverEnvOf(),
  }),
});

const cellPlanOf = (cell: string, project: string | undefined): Plan => {
  const cellName = cellNameOf(cell);
  const unitName = cellUnitNameOf(cellName);
  const joinToken = process.env[JOIN_TOKEN_ENV];
  const hasToken = joinToken !== undefined && joinToken !== '';
  const envFile = hasToken ? envFileOf(unitName) : undefined;
  const env: Record<string, string> = {};
  if (process.env[CELL_LINES_ENV]) {
    env[CELL_LINES_ENV] = process.env[CELL_LINES_ENV];
  }
  return {
    unitName,
    text: cellUnitOf({
      cellName,
      execArgs: [
        process.execPath,
        ...cellWorkerLauncherOf(IS_COMPILED, process.argv[1] ?? ''),
        'cell',
        'start',
        '--name',
        cellName,
        ...(project === undefined ? [] : ['--project', project]),
      ],
      workingDir: resolve(process.cwd()),
      env,
      envFile,
    }),
    ...(envFile === undefined || joinToken === undefined
      ? {}
      : {
          secret: { path: envFile, text: `${JOIN_TOKEN_ENV}=${joinToken}\n` },
        }),
  };
};

const assertNotForeign = (unitName: string): void => {
  const path = unitPathOf(unitName);
  if (isUnitTaken(path) && readUnitIfManaged(path) === null) {
    throw new Refused(
      `${path} exists and was not written by sf service install`,
    );
  }
};

const assertLinux = (): void => {
  if (process.platform !== 'linux') {
    throw new Refused('sf service writes systemd user units: Linux only');
  }
};

const runInstall = (
  cell: string | undefined,
  project: string | undefined,
): void => {
  assertLinux();
  const plans = [
    serverPlanOf(),
    ...(cell === undefined ? [] : [cellPlanOf(cell, project)]),
  ];
  plans.forEach((plan) => assertNotForeign(plan.unitName));
  for (const plan of plans) {
    writeUnitFile(unitPathOf(plan.unitName), plan.text);
    if (plan.secret !== undefined) {
      writeSecretEnvFile(plan.secret.path, plan.secret.text);
    } else if (plan.unitName !== SERVER_UNIT_NAME) {
      removeFileIfExists(envFileOf(plan.unitName));
    }
    printLine(`wrote ${unitPathOf(plan.unitName)}`);
  }
  const names = plans.map((plan) => plan.unitName).join(' ');
  printLine(`run: systemctl --user daemon-reload`);
  printLine(`run: systemctl --user enable --now ${names}`);
  printLine(
    'run: loginctl enable-linger $USER  (keeps units up after logout and starts them on boot)',
  );
};

const managedCellUnitsOf = (): string[] =>
  listUnitFiles(SYSTEMD_USER_DIR).filter(
    (name) => cellNameOfUnit(name) !== null,
  );

const runUninstall = (cell: string | undefined): void => {
  const explicit = cell !== undefined;
  const targets = explicit
    ? [cellUnitNameOf(cellNameOf(cell))]
    : [SERVER_UNIT_NAME, ...managedCellUnitsOf()];
  const removed: string[] = [];
  for (const unitName of targets) {
    const path = unitPathOf(unitName);
    if (readUnitIfManaged(path) === null) {
      if (explicit && isUnitTaken(path)) {
        throw new Refused(
          `${path} was not written by sf service install, not removing it`,
        );
      }
      continue;
    }
    removeFileIfExists(path);
    if (unitName !== SERVER_UNIT_NAME) {
      removeFileIfExists(envFileOf(unitName));
    }
    removed.push(unitName);
    printLine(`removed ${path}`);
  }
  if (removed.length === 0) {
    printLine('no sf units installed');
    return;
  }
  printLine(`if still running: systemctl --user stop ${removed.join(' ')}`);
  printLine('run: systemctl --user daemon-reload');
};

export const serviceCommand = defineCommand({
  meta: {
    name: 'service',
    description: 'Run the server and Cells as systemd user units (Linux)',
  },
  subCommands: {
    install: defineCommand({
      meta: {
        name: 'install',
        description:
          'Write systemd user units for the server and an optional Cell',
      },
      args: {
        cell: {
          type: 'string',
          description:
            'Also write sf-cell-<name>.service running this Cell in the current directory',
        },
        project: {
          type: 'string',
          description: 'Factory project id for the Cell',
        },
      },
      run: ({ args }) => {
        runInstall(args.cell, args.project);
      },
    }),
    uninstall: defineCommand({
      meta: {
        name: 'uninstall',
        description:
          'Remove the sf units install wrote (all, or one Cell with --cell)',
      },
      args: {
        cell: {
          type: 'string',
          description: 'Remove only sf-cell-<name>.service',
        },
      },
      run: ({ args }) => {
        runUninstall(args.cell);
      },
    }),
  },
});
