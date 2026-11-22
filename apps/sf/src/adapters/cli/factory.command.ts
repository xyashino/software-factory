import { join } from 'node:path';
import { defineCommand } from 'citty';
import { buildContext } from '../../bootstrap/context';
import { runWithoutToken } from '../../bootstrap/run';
import {
  DEFAULT_DATA_DIR,
  FACTORY_DAEMON_PORT,
  FACTORY_LOG_FILE,
  IS_COMPILED,
  factoryDaemonArgsOf,
} from '../../config';
import { startFactory } from '../../application/procedures/factory/start.procedure';
import { statusFactory } from '../../application/procedures/factory/status.procedure';
import { stopFactory } from '../../application/procedures/factory/stop.procedure';
import { EXIT } from '../../domain/exit-codes';
import { printJson, printLine, reportFailure } from './output';

const runStart = async (json: boolean): Promise<number> => {
  const ports = buildContext();
  const result = await runWithoutToken(
    startFactory,
    {
      bin: process.execPath,
      args: factoryDaemonArgsOf(IS_COMPILED),
      dataDir: DEFAULT_DATA_DIR,
      logPath: join(DEFAULT_DATA_DIR, FACTORY_LOG_FILE),
      factoryUrl: ports.connection.url,
      token: ports.connection.token,
      port: FACTORY_DAEMON_PORT,
    },
    ports,
  );
  if (result.kind === 'ok') {
    if (json) {
      printJson(result.value);
    } else {
      printLine(
        `factory started, pid ${result.value.pid}, url ${result.value.url}`,
      );
    }
  }
  return reportFailure(result);
};

const runStop = async (json: boolean): Promise<number> => {
  const result = await runWithoutToken(
    stopFactory,
    { dataDir: DEFAULT_DATA_DIR },
    () => buildContext(),
  );
  if (result.kind === 'ok') {
    if (json) {
      printJson(result.value);
    } else {
      printLine(
        result.value.outcome === 'stopped'
          ? 'factory stopped'
          : 'factory not running',
      );
    }
  }
  return reportFailure(result);
};

const runStatus = async (json: boolean): Promise<number> => {
  const result = await runWithoutToken(
    statusFactory,
    { dataDir: DEFAULT_DATA_DIR },
    () => buildContext(),
  );
  if (result.kind !== 'ok') {
    return reportFailure(result);
  }
  if (json) {
    printJson(result.value);
  } else if (result.value.running) {
    printLine(`factory running, pid ${result.value.pid}`);
  } else if (result.value.healthy) {
    printLine('factory not running: another factory answers on its port');
  } else {
    printLine('factory not running');
  }
  return result.value.running ? EXIT.ok : EXIT.refused;
};

const jsonArg = { type: 'boolean', default: false } as const;

export const factoryCommand = defineCommand({
  meta: {
    name: 'factory',
    description: 'Start, stop and check the local Factory daemon',
  },
  subCommands: {
    start: defineCommand({
      meta: {
        name: 'start',
        description: 'Start the Factory daemon on 127.0.0.1',
      },
      args: { json: jsonArg },
      run: async ({ args }) => {
        process.exitCode = await runStart(args.json);
      },
    }),
    stop: defineCommand({
      meta: {
        name: 'stop',
        description: 'Stop the Factory daemon and its Cells',
      },
      args: { json: jsonArg },
      run: async ({ args }) => {
        process.exitCode = await runStop(args.json);
      },
    }),
    status: defineCommand({
      meta: { name: 'status', description: 'Show whether the Factory runs' },
      args: { json: jsonArg },
      run: async ({ args }) => {
        process.exitCode = await runStatus(args.json);
      },
    }),
  },
});
