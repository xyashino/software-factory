import { defineCommand } from 'citty';
import { buildContext } from '../../bootstrap/context';
import { type RunResult, runWithoutToken } from '../../bootstrap/run';
import {
  DEFAULT_DATA_DIR,
  DEFAULT_DB_PATH,
  DEFAULT_PORT,
  SERVER_ENTRY,
} from '../../config';
import { startServer } from '../../application/procedures/server/start.procedure';
import { stopServer } from '../../application/procedures/server/stop.procedure';
import { createServerToken } from '../../application/procedures/server/token-create.procedure';
import { EXIT } from '../../domain/exit-codes';
import { printError, printJson, printLine } from './output';

interface Paths {
  dataDir: string;
  dbPath: string;
}

const pathsFromEnv = (): Paths => ({
  dataDir: process.env.FACTORY_DATA_DIR ?? DEFAULT_DATA_DIR,
  dbPath: process.env.FACTORY_DB_PATH ?? DEFAULT_DB_PATH,
});

const reportFailure = <O>(result: RunResult<O>): number => {
  if (result.kind === 'ok') {
    return EXIT.ok;
  }
  printError(result.message);
  return result.exitCode;
};

const runStart = async (json: boolean): Promise<number> => {
  const paths = pathsFromEnv();
  const result = await runWithoutToken(
    startServer,
    {
      bin: process.execPath,
      serverEntry: SERVER_ENTRY,
      dataDir: paths.dataDir,
      dbPath: paths.dbPath,
      port: Number(process.env.FACTORY_PORT ?? DEFAULT_PORT),
    },
    buildContext(),
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
    stopServer,
    { dataDir: pathsFromEnv().dataDir },
    buildContext(),
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
  }
  return reportFailure(result);
};

const runTokenCreate = async (
  json: boolean,
  save: boolean,
): Promise<number> => {
  const result = await runWithoutToken(
    createServerToken,
    {
      bin: process.execPath,
      serverEntry: SERVER_ENTRY,
      cwd: process.cwd(),
      dbPath: pathsFromEnv().dbPath,
      save,
    },
    buildContext(),
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

export const serverCommand = defineCommand({
  meta: {
    name: 'server',
    description: 'Start, stop and provision the factory server',
  },
  subCommands: {
    start: defineCommand({
      meta: { name: 'start', description: 'Start the factory server' },
      args: { json: { type: 'boolean', default: false } },
      run: async ({ args }) => {
        process.exitCode = await runStart(args.json);
      },
    }),
    stop: defineCommand({
      meta: {
        name: 'stop',
        description: 'Stop the factory server process only',
      },
      args: { json: { type: 'boolean', default: false } },
      run: async ({ args }) => {
        process.exitCode = await runStop(args.json);
      },
    }),
    token: defineCommand({
      meta: { name: 'token', description: 'Manage the supervisor token' },
      subCommands: {
        create: defineCommand({
          meta: {
            name: 'create',
            description: 'Create a supervisor token and print it once',
          },
          args: {
            json: { type: 'boolean', default: false },
            save: {
              type: 'boolean',
              default: false,
              description: 'Write the token to the token file, print nothing',
            },
          },
          run: async ({ args }) => {
            process.exitCode = await runTokenCreate(args.json, args.save);
          },
        }),
      },
    }),
  },
});
