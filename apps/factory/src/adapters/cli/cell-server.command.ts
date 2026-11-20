import { defineCommand } from 'citty';
import type { RunResult } from '../../bootstrap/run';
import {
  DEFAULT_DATA_DIR,
  IS_COMPILED,
  XDG_DATA_HOME,
  cellServerArgsOf,
} from '../../config';
import { startCellServer } from '../../application/procedures/cell-server/start.procedure';
import { stopCellServer } from '../../application/procedures/cell-server/stop.procedure';
import { statusCellServer } from '../../application/procedures/cell-server/status.procedure';
import {
  addFactory,
  listFactories,
  removeFactory,
  useFactory,
} from '../../application/procedures/cell-server/factories.procedure';
import {
  getSettings,
  setSettings,
} from '../../application/procedures/cell-server/settings.procedure';
import { cellServerEndpoint, runCellServer } from './cell-server-run';
import { printJson, printLine, printTable, reportFailure } from './output';

const finish = <O>(
  result: RunResult<O>,
  render: (value: O) => void,
): number => {
  if (result.kind === 'ok') {
    render(result.value);
  }
  return reportFailure(result);
};

const yesNo = (flag: boolean): string => (flag ? 'yes' : 'no');

const runStart = async (json: boolean): Promise<number> => {
  const { host, port } = cellServerEndpoint();
  const result = await runCellServer(startCellServer, {
    bin: process.execPath,
    serverArgs: cellServerArgsOf(IS_COMPILED),
    dataDir: DEFAULT_DATA_DIR,
    xdgDataHome: XDG_DATA_HOME,
    host,
    port,
  });
  return finish(result, (value) =>
    json
      ? printJson(value)
      : printLine(`cell server started, pid ${value.pid}`),
  );
};

const runStop = async (json: boolean): Promise<number> => {
  const result = await runCellServer(stopCellServer, {
    dataDir: DEFAULT_DATA_DIR,
  });
  return finish(result, (value) =>
    json ? printJson(value) : printLine(`cell server ${value.outcome}`),
  );
};

const runStatus = async (json: boolean): Promise<number> => {
  const result = await runCellServer(statusCellServer, {
    dataDir: DEFAULT_DATA_DIR,
  });
  return finish(result, (value) => {
    if (json) {
      printJson(value);
      return;
    }
    printLine(`healthy: ${yesNo(value.healthy)}`);
    printLine(`pid: ${value.pid ?? '-'} (alive: ${yesNo(value.alive)})`);
    if (value.settings !== null) {
      printLine(`default runner: ${value.settings.default_runner}`);
      printLine(`max local cells: ${value.settings.max_local_cells}`);
    }
  });
};

const runFactoryAdd = async (
  name: string,
  url: string,
  options: {
    joinToken?: string;
    supervisorToken?: string;
    default: boolean;
    json: boolean;
  },
): Promise<number> => {
  const result = await runCellServer(addFactory, {
    name,
    url,
    joinToken: options.joinToken,
    supervisorToken: options.supervisorToken,
    isDefault: options.default,
  });
  return finish(result, (value) =>
    options.json ? printJson(value) : printLine(`factory ${value.name} saved`),
  );
};

const runFactoryList = async (json: boolean): Promise<number> => {
  const result = await runCellServer(listFactories, {});
  return finish(result, (rows) => {
    if (json) {
      printJson(rows);
      return;
    }
    printTable(
      ['name', 'url', 'default', 'join token', 'supervisor token'],
      rows.map((row) => [
        row.name,
        row.url,
        yesNo(row.isDefault),
        yesNo(row.hasJoinToken),
        yesNo(row.hasSupervisorToken),
      ]),
    );
  });
};

const runFactoryUse = async (name: string, json: boolean): Promise<number> => {
  const result = await runCellServer(useFactory, { name });
  return finish(result, (value) =>
    json ? printJson(value) : printLine(`default factory ${value.name}`),
  );
};

const runFactoryRemove = async (
  name: string,
  json: boolean,
): Promise<number> => {
  const result = await runCellServer(removeFactory, { name });
  return finish(result, (factoryId) =>
    json ? printJson({ factoryId }) : printLine(`factory ${name} removed`),
  );
};

const runConfigGet = async (key: string | undefined): Promise<number> => {
  const result = await runCellServer(getSettings, { key });
  return finish(result, (settings) => {
    if (key !== undefined) {
      printLine(String(settings[key as keyof typeof settings]));
      return;
    }
    printTable(
      ['key', 'value'],
      Object.entries(settings).map(([name, value]) => [name, String(value)]),
    );
  });
};

const runConfigSet = async (
  key: string,
  value: string,
  json: boolean,
): Promise<number> => {
  const result = await runCellServer(setSettings, { key, value });
  return finish(result, (settings) =>
    json
      ? printJson(settings)
      : printLine(`${key} = ${String(settings[key as keyof typeof settings])}`),
  );
};

const jsonArg = { type: 'boolean', default: false } as const;

const factoryCommand = defineCommand({
  meta: { name: 'factory', description: 'Manage saved Factory targets' },
  subCommands: {
    add: defineCommand({
      meta: { name: 'add', description: 'Save a Factory target' },
      args: {
        name: {
          type: 'positional',
          required: true,
          description: 'Target name',
        },
        url: { type: 'positional', required: true, description: 'Factory URL' },
        joinToken: { type: 'string', description: 'Join token for new Cells' },
        supervisorToken: {
          type: 'string',
          description: 'Supervisor token to mint join tokens',
        },
        default: {
          type: 'boolean',
          default: false,
          description: 'Make it the default',
        },
        json: jsonArg,
      },
      run: async ({ args }) => {
        process.exitCode = await runFactoryAdd(args.name, args.url, args);
      },
    }),
    ls: defineCommand({
      meta: { name: 'ls', description: 'List saved Factory targets' },
      args: { json: jsonArg },
      run: async ({ args }) => {
        process.exitCode = await runFactoryList(args.json);
      },
    }),
    use: defineCommand({
      meta: { name: 'use', description: 'Make a Factory target the default' },
      args: {
        name: {
          type: 'positional',
          required: true,
          description: 'Target name',
        },
        json: jsonArg,
      },
      run: async ({ args }) => {
        process.exitCode = await runFactoryUse(args.name, args.json);
      },
    }),
    rm: defineCommand({
      meta: { name: 'rm', description: 'Remove a saved Factory target' },
      args: {
        name: {
          type: 'positional',
          required: true,
          description: 'Target name',
        },
        json: jsonArg,
      },
      run: async ({ args }) => {
        process.exitCode = await runFactoryRemove(args.name, args.json);
      },
    }),
  },
});

const configCommand = defineCommand({
  meta: { name: 'config', description: 'Read and write cell server settings' },
  subCommands: {
    get: defineCommand({
      meta: { name: 'get', description: 'Show all settings or one key' },
      args: {
        key: {
          type: 'positional',
          required: false,
          description: 'Setting key',
        },
      },
      run: async ({ args }) => {
        process.exitCode = await runConfigGet(args.key);
      },
    }),
    set: defineCommand({
      meta: { name: 'set', description: 'Change one setting' },
      args: {
        key: { type: 'positional', required: true, description: 'Setting key' },
        value: { type: 'positional', required: true, description: 'New value' },
        json: jsonArg,
      },
      run: async ({ args }) => {
        process.exitCode = await runConfigSet(args.key, args.value, args.json);
      },
    }),
  },
});

export const cellServerCommand = defineCommand({
  meta: {
    name: 'server',
    description: 'Start, stop and configure the local cell server',
  },
  subCommands: {
    start: defineCommand({
      meta: { name: 'start', description: 'Start the local cell server' },
      args: { json: jsonArg },
      run: async ({ args }) => {
        process.exitCode = await runStart(args.json);
      },
    }),
    stop: defineCommand({
      meta: { name: 'stop', description: 'Stop the local cell server process' },
      args: { json: jsonArg },
      run: async ({ args }) => {
        process.exitCode = await runStop(args.json);
      },
    }),
    status: defineCommand({
      meta: {
        name: 'status',
        description: 'Show cell server process and settings',
      },
      args: { json: jsonArg },
      run: async ({ args }) => {
        process.exitCode = await runStatus(args.json);
      },
    }),
    factory: factoryCommand,
    config: configCommand,
  },
});
