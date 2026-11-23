import { hostname } from 'node:os';
import { resolve } from 'node:path';
import { defineCommand } from 'citty';
import { buildContext } from '../../bootstrap/context';
import { runWithoutToken, settle } from '../../bootstrap/run';
import {
  CELL_ID_ENV,
  CELL_LINES_ENV,
  FACTORY_PID_ENV,
  cellLogPathOf,
  isRelayedOf,
} from '../../config';
import { Refused } from '../../application/core/errors';
import type { Ports } from '../../application/core/procedure';
import { startCell } from '../../application/procedures/cell/start.procedure';
import {
  createFactoryCell,
  type FactoryCell,
  listFactoryCells,
  removeFactoryCell,
} from '../../application/procedures/cell/factory-cells';
import { cellNameOf } from '../../domain/cell/cell-name';
import { parentGoneOf } from '../../domain/cell/parent-gone';
import { EXIT } from '../../domain/exit-codes';
import { claimCellSlot, releaseCellSlot } from '../fs/cell-slot';
import {
  printError,
  printJson,
  printLine,
  printTable,
  reportFailure,
} from './output';
import { promptSelect } from './prompt-select';

const FACTORY_HEADERS = ['id', 'name', 'pid', 'repo'];
const SUPERSEDED_LINE =
  'cell left: the server had already moved its job, nothing handed over';
const FORCED_STOP_LINE =
  'cell stopped by a second signal: exiting now, a runner may still be alive';
const FORCED_STOP_EXIT = 130;
const PARENT_GONE_LINE = 'factory daemon is gone: stopping this cell';
const PARENT_GONE_EXIT = 1;
const DAEMON_WATCH_MS = 1_000;
// A claim long-polls and only sees the abort when it returns, so the exit is forced.
const PARENT_GONE_GRACE_MS = 1_000;

const cliError = (message: string): Error => {
  const error = new Error(message);
  error.name = 'CLIError';
  return error;
};

const linesOf = (raw: string | undefined): string[] | undefined => {
  const lines = raw
    ?.split(',')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines === undefined || lines.length === 0 ? undefined : lines;
};

const claimSlot = async (
  cwd: string,
  requested: string | undefined,
): Promise<string> => {
  if (requested !== undefined) {
    const name = cellNameOf(requested);
    if (!(await claimCellSlot(cwd, name))) {
      throw new Refused(`cell ${name} already running`);
    }
    return name;
  }
  const base = cellNameOf(hostname());
  for (let suffix = 1; ; suffix += 1) {
    const name = suffix === 1 ? base : `${base}-${suffix}`;
    if (await claimCellSlot(cwd, name)) {
      return name;
    }
  }
};

const chooserOf = (): typeof promptSelect | undefined =>
  process.stdin.isTTY ? promptSelect : undefined;

const daemonWatchOf = (
  ports: Ports,
  onGone: () => void,
): ReturnType<typeof setInterval> | undefined => {
  const raw = process.env[FACTORY_PID_ENV];
  if (raw === undefined) {
    return undefined;
  }
  const daemonPid = Number(raw);
  const timer = setInterval(() => {
    if (parentGoneOf(daemonPid, ports.process.parentPid())) {
      clearInterval(timer);
      onGone();
    }
  }, DAEMON_WATCH_MS);
  return timer;
};

const onParentGone = (controller: AbortController): void => {
  printError(PARENT_GONE_LINE);
  controller.abort();
  setTimeout(
    () => process.exit(PARENT_GONE_EXIT),
    PARENT_GONE_GRACE_MS,
  ).unref();
};

const runStart = async (
  requested: string | undefined,
  project: string | undefined,
): Promise<number> => {
  const cwd = process.cwd();
  const claim = await settle(() => claimSlot(cwd, requested));
  if (claim.kind === 'failed') {
    return reportFailure(claim);
  }
  const name = claim.value;
  const controller = new AbortController();
  const stop = (): void => {
    if (controller.signal.aborted) {
      printError(FORCED_STOP_LINE);
      process.exit(FORCED_STOP_EXIT);
    }
    controller.abort();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  const ports = buildContext(name);
  const watch = daemonWatchOf(ports, () => onParentGone(controller));
  try {
    const result = await settle(() =>
      startCell(ports, {
        repoRoot: cwd,
        cellId: process.env[CELL_ID_ENV],
        logPath: resolve(cwd, cellLogPathOf(name)),
        lines: linesOf(process.env[CELL_LINES_ENV]),
        relayed: isRelayedOf(process.env),
        project,
        choose: chooserOf(),
        signal: controller.signal,
      }),
    );
    if (result.kind === 'ok' && result.value === 'superseded') {
      printLine(SUPERSEDED_LINE);
    }
    return reportFailure(result);
  } finally {
    clearInterval(watch);
    await releaseCellSlot(cwd, name);
  }
};

const factoryRows = (cells: FactoryCell[]): string[][] =>
  cells.map((cell) => [
    cell.cellId,
    cell.name,
    String(cell.pid),
    cell.repoRoot,
  ]);

const runList = async (json: boolean): Promise<number> => {
  const result = await runWithoutToken(listFactoryCells, {}, () =>
    buildContext(),
  );
  if (result.kind !== 'ok') {
    return reportFailure(result);
  }
  if (json) {
    printJson(result.value);
  } else {
    printTable(FACTORY_HEADERS, factoryRows(result.value));
  }
  return EXIT.ok;
};

const runStop = async (
  id: string | undefined,
  options: { all: boolean; json: boolean },
): Promise<number> => {
  if (!options.all && id === undefined) {
    throw cliError('cell id required, or --all');
  }
  const listed = await runWithoutToken(listFactoryCells, {}, () =>
    buildContext(),
  );
  if (listed.kind !== 'ok') {
    return reportFailure(listed);
  }
  if (options.all) {
    return stopCells(
      listed.value.map((cell) => cell.cellId),
      options.json,
    );
  }
  if (id === undefined) {
    throw cliError('cell id required, or --all');
  }
  if (!listed.value.some((cell) => cell.cellId === id)) {
    printError(`no local cell ${id}`);
    return EXIT.refused;
  }
  return stopCells([id], options.json);
};

const stopCells = async (
  cellIds: readonly string[],
  json: boolean,
): Promise<number> => {
  const stopped: string[] = [];
  for (const cellId of cellIds) {
    const removed = await runWithoutToken(
      removeFactoryCell,
      { id: cellId },
      () => buildContext(),
    );
    if (removed.kind !== 'ok') {
      return reportFailure(removed);
    }
    stopped.push(removed.value);
  }
  if (json) {
    printJson(stopped.map((cellId) => ({ cellId })));
  } else {
    for (const cellId of stopped) {
      printLine(`cell ${cellId} stopped`);
    }
  }
  return EXIT.ok;
};

const runCreate = async (options: {
  repo: string;
  name: string | undefined;
  count: string;
  lines: string | undefined;
  json: boolean;
}): Promise<number> => {
  const count = Number(options.count);
  if (!Number.isInteger(count) || count < 1) {
    printError('count must be a positive integer');
    return EXIT.argument;
  }
  if (options.name !== undefined && count > 1) {
    printError('name is only allowed with count 1');
    return EXIT.argument;
  }
  const created: FactoryCell[] = [];
  for (let index = 0; index < count; index += 1) {
    const result = await runWithoutToken(
      createFactoryCell,
      {
        repoRoot: resolve(options.repo),
        name: options.name,
        lines: linesOf(options.lines),
      },
      () => buildContext(),
    );
    if (result.kind !== 'ok') {
      return reportFailure(result);
    }
    created.push(result.value);
  }
  if (options.json) {
    printJson(created);
  } else {
    printTable(FACTORY_HEADERS, factoryRows(created));
  }
  return EXIT.ok;
};

const runRemove = async (id: string, json: boolean): Promise<number> => {
  const result = await runWithoutToken(removeFactoryCell, { id }, () =>
    buildContext(),
  );
  if (result.kind !== 'ok') {
    return reportFailure(result);
  }
  if (json) {
    printJson({ cellId: result.value });
  } else {
    printLine(`removed ${result.value}`);
  }
  return EXIT.ok;
};

const startCommand = defineCommand({
  meta: {
    name: 'start',
    description: 'Run this Cell loop (the Factory daemon starts it)',
  },
  args: {
    name: {
      type: 'string',
      description:
        'Cell name, unique while running (default: hostname, then hostname-2, ...)',
    },
    project: {
      type: 'string',
      description:
        'Factory project id, required outside a repo with .factory/config.json',
    },
  },
  run: async ({ args }) => {
    process.exitCode = await runStart(
      args.name ?? process.env.CELL_NAME,
      args.project,
    );
  },
});

const listCommand = defineCommand({
  meta: {
    name: 'list',
    description: 'Show the Cells of the local Factory daemon',
  },
  args: {
    json: { type: 'boolean', default: false },
  },
  run: async ({ args }) => {
    process.exitCode = await runList(args.json);
  },
});

const createCommand = defineCommand({
  meta: {
    name: 'create',
    description: 'Start Cells in a project repo via the local Factory daemon',
  },
  args: {
    repo: { type: 'string', default: '.', description: 'Repository root' },
    name: { type: 'string', description: 'Cell name (count 1 only)' },
    count: { type: 'string', default: '1', description: 'Number of Cells' },
    lines: { type: 'string', description: 'Comma-separated line names' },
    json: { type: 'boolean', default: false },
  },
  run: async ({ args }) => {
    process.exitCode = await runCreate(args);
  },
});

const stopCommand = defineCommand({
  meta: {
    name: 'stop',
    description: 'Stop a local Cell through the Factory daemon',
  },
  args: {
    slot: { type: 'positional', required: false, description: 'Cell id' },
    id: { type: 'string', description: 'Cell id (same as the positional)' },
    all: {
      type: 'boolean',
      default: false,
      description: 'Stop every Cell of the local Factory daemon',
    },
    json: { type: 'boolean', default: false },
  },
  run: async ({ args }) => {
    process.exitCode = await runStop(args.slot ?? args.id, args);
  },
});

const removeCommand = defineCommand({
  meta: { name: 'rm', description: 'Stop and remove a local Cell' },
  args: {
    id: { type: 'positional', required: true, description: 'Cell id' },
    json: { type: 'boolean', default: false },
  },
  run: async ({ args }) => {
    process.exitCode = await runRemove(args.id, args.json);
  },
});

export const cellCommand = defineCommand({
  meta: {
    name: 'cell',
    description: 'Run this machine as a Cell and manage registered Cells',
  },
  subCommands: {
    start: startCommand,
    list: listCommand,
    stop: stopCommand,
    create: createCommand,
    rm: removeCommand,
  },
});
