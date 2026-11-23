import { defineCommand } from 'citty';
import { buildContext } from '../../bootstrap/context';
import { runWithoutToken } from '../../bootstrap/run';
import {
  DEFAULT_DATA_DIR,
  DEFAULT_DB_PATH,
  DEFAULT_FACTORY_URL,
  DEFAULT_PORT,
  IS_COMPILED,
  serverArgsOf,
} from '../../config';
import { startHq } from '../../application/procedures/hq/start.procedure';
import { stopHq } from '../../application/procedures/hq/stop.procedure';
import { createHqToken } from '../../application/procedures/hq/token-create.procedure';
import { hqSettingOf, hqUrlEnv } from '../../bootstrap/hq-env';
import { connectCommand } from './connection.command';
import { printError, printJson, printLine, reportFailure } from './output';
import {
  hqTargetLsCommand,
  hqTargetRmCommand,
  hqTargetUseCommand,
} from './target.command';
import { hqTokenCreateCommand } from './token.command';
import { parsePort } from './validate';

interface Paths {
  dataDir: string;
  dbPath: string;
}

const pathsFromEnv = (): Paths => ({
  dataDir: hqSettingOf('DATA_DIR') ?? DEFAULT_DATA_DIR,
  dbPath: hqSettingOf('DB_PATH') ?? DEFAULT_DB_PATH,
});

const runStart = async (json: boolean): Promise<number> => {
  const paths = pathsFromEnv();
  const port = parsePort(hqSettingOf('PORT') ?? DEFAULT_PORT, 'HQ_PORT');
  const result = await runWithoutToken(
    startHq,
    {
      bin: process.execPath,
      serverArgs: serverArgsOf(IS_COMPILED),
      cwd: process.cwd(),
      dataDir: paths.dataDir,
      dbPath: paths.dbPath,
      port,
      host: hqSettingOf('HOST'),
    },
    () => buildContext(),
  );
  if (result.kind === 'ok') {
    if (json) {
      printJson(result.value);
    } else {
      printLine(`server started, pid ${result.value.pid}`);
    }
  }
  return reportFailure(result);
};

const runStop = async (json: boolean): Promise<number> => {
  const result = await runWithoutToken(
    stopHq,
    { dataDir: pathsFromEnv().dataDir },
    () => buildContext(),
  );
  if (result.kind === 'ok') {
    if (json) {
      printJson(result.value);
    } else {
      printLine(
        result.value.outcome === 'stopped'
          ? 'server stopped'
          : 'server not running',
      );
    }
    if (result.value.outcome === 'not-running' && result.value.warning) {
      printError(`warning: ${result.value.warning}`);
    }
  }
  return reportFailure(result);
};

const runTokenCreate = async (
  json: boolean,
  save: boolean,
  global: boolean,
): Promise<number> => {
  const result = await runWithoutToken(
    createHqToken,
    {
      bin: process.execPath,
      serverArgs: serverArgsOf(IS_COMPILED),
      cwd: process.cwd(),
      dbPath: pathsFromEnv().dbPath,
      url: hqUrlEnv()?.value ?? DEFAULT_FACTORY_URL,
      save,
      global,
    },
    () => buildContext(),
  );
  if (result.kind === 'ok' && result.value.token !== null) {
    if (json) {
      printJson({ token: result.value.token });
    } else {
      printLine(result.value.token);
    }
  }
  return reportFailure(result);
};

export const hqStartCommand = defineCommand({
  meta: { name: 'start', description: 'Start the HQ server on this PC' },
  args: { json: { type: 'boolean', default: false } },
  run: async ({ args }) => {
    process.exitCode = await runStart(args.json);
  },
});

export const hqStopCommand = defineCommand({
  meta: {
    name: 'stop',
    description: 'Stop the HQ server process only',
  },
  args: { json: { type: 'boolean', default: false } },
  run: async ({ args }) => {
    process.exitCode = await runStop(args.json);
  },
});

export const hqTokenAdminCreateCommand = defineCommand({
  meta: {
    name: 'create',
    description: 'Create an admin token for HQ and print it once',
  },
  args: {
    json: { type: 'boolean', default: false },
    save: {
      type: 'boolean',
      default: false,
      description:
        'Save the token (repo token file, or global config outside a factory repo), print nothing',
    },
    global: {
      type: 'boolean',
      default: false,
      description: 'Save the token in the global config',
    },
  },
  run: async ({ args }) => {
    process.exitCode = await runTokenCreate(args.json, args.save, args.global);
  },
});

const hqTargetCommand = defineCommand({
  meta: {
    name: 'target',
    description: 'List, select and remove saved HQ targets',
  },
  subCommands: {
    ls: hqTargetLsCommand,
    use: hqTargetUseCommand,
    rm: hqTargetRmCommand,
  },
});

const hqTokenCommand = defineCommand({
  meta: {
    name: 'token',
    description: 'Mint tokens on HQ, manage the admin token',
  },
  subCommands: {
    create: hqTokenCreateCommand,
    admin: defineCommand({
      meta: {
        name: 'admin',
        description: 'Admin token of the local HQ server',
      },
      subCommands: { create: hqTokenAdminCreateCommand },
    }),
  },
});

export const hqCommand = defineCommand({
  meta: {
    name: 'hq',
    description: 'Start, stop and reach the HQ server',
  },
  subCommands: {
    start: hqStartCommand,
    stop: hqStopCommand,
    connect: connectCommand,
    target: hqTargetCommand,
    token: hqTokenCommand,
  },
});
