import { defineCommand } from 'citty';
import { buildContext } from '../../bootstrap/context';
import { runWithoutToken } from '../../bootstrap/run';
import {
  DEFAULT_DATA_DIR,
  DEFAULT_DB_PATH,
  DEFAULT_PORT,
  IS_COMPILED,
  serverArgsOf,
} from '../../config';
import { startServer } from '../../application/procedures/server/start.procedure';
import { stopServer } from '../../application/procedures/server/stop.procedure';
import { createServerToken } from '../../application/procedures/server/token-create.procedure';
import { printJson, printLine, reportFailure } from './output';
import { parsePort } from './validate';

interface Paths {
  dataDir: string;
  dbPath: string;
}

const pathsFromEnv = (): Paths => ({
  dataDir: process.env.FACTORY_DATA_DIR ?? DEFAULT_DATA_DIR,
  dbPath: process.env.FACTORY_DB_PATH ?? DEFAULT_DB_PATH,
});

const runStart = async (json: boolean): Promise<number> => {
  const paths = pathsFromEnv();
  const port = parsePort(
    process.env.FACTORY_PORT ?? DEFAULT_PORT,
    'FACTORY_PORT',
  );
  const result = await runWithoutToken(
    startServer,
    {
      bin: process.execPath,
      serverArgs: serverArgsOf(IS_COMPILED),
      dataDir: paths.dataDir,
      dbPath: paths.dbPath,
      port,
      host: process.env.FACTORY_HOST || undefined,
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
    stopServer,
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
      serverArgs: serverArgsOf(IS_COMPILED),
      cwd: process.cwd(),
      dbPath: pathsFromEnv().dbPath,
      save,
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
