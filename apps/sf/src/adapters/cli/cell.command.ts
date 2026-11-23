import { hostname } from 'node:os';
import { resolve } from 'node:path';
import { defineCommand } from 'citty';
import { buildContext } from '../../bootstrap/context';
import { run, runWithoutToken, settle } from '../../bootstrap/run';
import {
  CELL_LINES_ENV,
  FACTORY_PID_ENV,
  JOIN_TOKEN_ENV,
  cellLogPathOf,
  isRelayedOf,
} from '../../config';
import { Refused } from '../../application/core/errors';
import type { Ports } from '../../application/core/procedure';
import { startCell } from '../../application/procedures/cell/start.procedure';
import {
  createFactoryCell,
  type FactoryCell,
  listCellsWithFactory,
  listFactoryCells,
  removeFactoryCell,
} from '../../application/procedures/cell/factory-cells';
import { revokeCell } from '../../application/procedures/cell/revoke.procedure';
import { stopCell } from '../../application/procedures/cell/stop.procedure';
import { cellNameOf } from '../../domain/cell/cell-name';
import { parentGoneOf } from '../../domain/cell/parent-gone';
import { EXIT } from '../../domain/exit-codes';
import {
  claimCellSlot,
  migrateLegacyCellState,
  releaseCellSlot,
} from '../fs/cell-slot';
import {
  printError,
  printJson,
  printLine,
  printTable,
  reportFailure,
} from './output';
import { promptSelect } from './prompt-select';

const HEADERS = [
  'id',
  'project',
  'state',
  'active job',
  'last heartbeat',
  'pid',
];
const FACTORY_HEADERS = ['id', 'name', 'pid', 'repo'];
const SUPERSEDED_LINE =
  'cell left: the server had already moved its job, nothing handed over';
const MIGRATED_LINE = 'migrated legacy .factory-local/cell.json to this cell';
const OFFLINE_LINE =
  'Cell is offline, no heartbeat will deliver this; check the process or `sf cell revoke`';
const FORCED_STOP_LINE =
  'cell stopped by a second signal: exiting now, a runner may still be alive';
const FORCED_STOP_EXIT = 130;
const PARENT_GONE_LINE = 'factory daemon is gone: stopping this cell';
const PARENT_GONE_EXIT = 1;
const DAEMON_WATCH_MS = 1_000;
// A claim long-polls and only sees the abort when it returns, so the exit is forced.
const PARENT_GONE_GRACE_MS = 1_000;

const orDash = (value: string | null): string => value ?? '-';

const pidText = (pid: number | null): string =>
  pid === null ? '-' : String(pid);

const heartbeatText = (ms: number | null): string =>
  ms === null ? '-' : new Date(ms).toISOString();

const drainText = (force: boolean): string =>
  force
    ? 'draining (force): current station is aborted at the next heartbeat'
    : 'draining: leaves after the current station; use --force to abort it now';

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
    if (name === cellNameOf(hostname()) && migrateLegacyCellState(cwd, name)) {
      printLine(MIGRATED_LINE);
    }
    const result = await settle(() =>
      startCell(ports, {
        repoRoot: cwd,
        cellName: name,
        logPath: resolve(cwd, cellLogPathOf(name)),
        joinToken: process.env[JOIN_TOKEN_ENV],
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

const runList = async (json: boolean, here: boolean): Promise<number> => {
  if (here) {
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
  }
  const result = await run(listCellsWithFactory, {}, 'supervisor');
  if (result.kind !== 'ok') {
    return reportFailure(result);
  }
  if (json) {
    printJson(result.value);
    return EXIT.ok;
  }
  printTable(
    HEADERS,
    result.value.map((row) => [
      row.cellId,
      row.projectId,
      row.status,
      orDash(row.activeJobId),
      heartbeatText(row.lastHeartbeatAt),
      pidText(row.pid),
    ]),
  );
  return EXIT.ok;
};

const runStopOne = async (
  id: string,
  force: boolean,
  json: boolean,
): Promise<number> => {
  const local = await runWithoutToken(listFactoryCells, {}, () =>
    buildContext(),
  );
  if (local.kind !== 'ok') {
    return reportFailure(local);
  }
  if (local.value.some((cell) => cell.cellId === id)) {
    const removed = await runWithoutToken(removeFactoryCell, { id }, () =>
      buildContext(),
    );
    if (removed.kind !== 'ok') {
      return reportFailure(removed);
    }
    if (json) {
      printJson({ cellId: removed.value });
    } else {
      printLine(`cell ${removed.value} stopped`);
    }
    return EXIT.ok;
  }
  const remote = await run(stopCell, { id, force }, 'supervisor');
  if (remote.kind === 'ok') {
    printLine(`cell ${remote.value.cellId} ${drainText(remote.value.force)}`);
    if (remote.value.offline) printError(OFFLINE_LINE);
    return EXIT.ok;
  }
  return reportFailure(remote);
};

const runStopAll = async (json: boolean): Promise<number> => {
  const listed = await runWithoutToken(listFactoryCells, {}, () =>
    buildContext(),
  );
  if (listed.kind !== 'ok') {
    return reportFailure(listed);
  }
  const stopped: string[] = [];
  for (const cell of listed.value) {
    const removed = await runWithoutToken(
      removeFactoryCell,
      { id: cell.cellId },
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

const runStop = async (
  id: string | undefined,
  options: { all: boolean; force: boolean; json: boolean },
): Promise<number> => {
  if (options.all) {
    return runStopAll(options.json);
  }
  if (id === undefined) {
    throw cliError('cell id required, or --all');
  }
  return runStopOne(id, options.force, options.json);
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

const runRevoke = async (id: string, yes: boolean): Promise<number> => {
  const result = await run(revokeCell, { id, yes }, 'supervisor');
  if (result.kind === 'ok') {
    printLine(`revoked ${result.value.cellId}`);
    return EXIT.ok;
  }
  return reportFailure(result);
};

const startCommand = defineCommand({
  meta: {
    name: 'start',
    description: 'Enroll this Cell if needed and run its loop',
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
  meta: { name: 'list', description: 'Show registered Cells' },
  args: {
    json: { type: 'boolean', default: false },
    here: {
      type: 'boolean',
      default: false,
      description: 'Show only the Cells the local Factory daemon runs',
    },
    local: {
      type: 'boolean',
      default: false,
      description: 'Alias of --here',
    },
  },
  run: async ({ args }) => {
    process.exitCode = await runList(args.json, args.here || args.local);
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
    description:
      'Stop a local Cell through the Factory daemon, otherwise drain it via HQ',
  },
  args: {
    slot: { type: 'positional', required: false, description: 'Cell id' },
    id: { type: 'string', description: 'Cell id (same as the positional)' },
    all: {
      type: 'boolean',
      default: false,
      description: 'Stop every Cell of the local Factory daemon',
    },
    force: {
      type: 'boolean',
      default: false,
      description: 'Abort the running station and hand its Job over now',
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

const revokeCommand = defineCommand({
  meta: { name: 'revoke', description: 'Revoke a Cell (needs --yes)' },
  args: {
    id: { type: 'string', required: true, description: 'Cell id' },
    yes: {
      type: 'boolean',
      default: false,
      description: 'Confirm the revoke',
    },
  },
  run: async ({ args }) => {
    process.exitCode = await runRevoke(args.id, args.yes);
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
    revoke: revokeCommand,
    create: createCommand,
    rm: removeCommand,
  },
});
