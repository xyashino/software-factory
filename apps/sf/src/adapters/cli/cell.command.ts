import { hostname } from 'node:os';
import { resolve } from 'node:path';
import { defineCommand } from 'citty';
import { buildContext } from '../../bootstrap/context';
import { run, runWithoutToken, settle } from '../../bootstrap/run';
import {
  CELL_LINES_ENV,
  IS_COMPILED,
  JOIN_TOKEN_ENV,
  cellLogPathOf,
  cellWorkerLauncherOf,
} from '../../config';
import { Refused } from '../../application/core/errors';
import { startCell } from '../../application/procedures/cell/start.procedure';
import { createLocalCells } from '../../application/procedures/cell/local-create.procedure';
import {
  type LocalSlotRow,
  listCellsWithLocal,
  listLocalSlots,
} from '../../application/procedures/cell/local-list.procedure';
import { removeLocalCell } from '../../application/procedures/cell/local-rm.procedure';
import {
  stopAllLocalCells,
  stopLocalCell,
} from '../../application/procedures/cell/local-stop.procedure';
import { revokeCell } from '../../application/procedures/cell/revoke.procedure';
import { stopCell } from '../../application/procedures/cell/stop.procedure';
import { cellNameOf } from '../../domain/cell/cell-name';
import { EXIT } from '../../domain/exit-codes';
import {
  claimCellSlot,
  migrateLegacyCellState,
  releaseCellSlot,
} from '../fs/cell-slot';
import { cellServerCommand } from './cell-server.command';
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
const LOCAL_HEADERS = ['id', 'name', 'factory', 'state', 'pid', 'repo'];
const SUPERSEDED_LINE =
  'cell left: the server had already moved its job, nothing handed over';
const MIGRATED_LINE = 'migrated legacy .factory-local/cell.json to this cell';
const OFFLINE_LINE =
  'Cell is offline, no heartbeat will deliver this; check the process or `sf cell revoke`';

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
  const stop = (): void => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    if (name === cellNameOf(hostname()) && migrateLegacyCellState(cwd, name)) {
      printLine(MIGRATED_LINE);
    }
    const result = await settle(() =>
      startCell(buildContext(name), {
        repoRoot: cwd,
        cellName: name,
        logPath: resolve(cwd, cellLogPathOf(name)),
        joinToken: process.env[JOIN_TOKEN_ENV],
        lines: linesOf(process.env[CELL_LINES_ENV]),
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
    await releaseCellSlot(cwd, name);
  }
};

const localRows = (slots: LocalSlotRow[]): string[][] =>
  slots.map((slot) => [
    slot.slotId,
    slot.name,
    slot.factory,
    slot.state,
    pidText(slot.pid),
    slot.repoRoot,
  ]);

const runLocalList = async (json: boolean): Promise<number> => {
  const result = await runWithoutToken(listLocalSlots, {}, buildContext());
  if (result.kind !== 'ok') {
    return reportFailure(result);
  }
  if (json) {
    printJson(result.value);
  } else {
    printTable(LOCAL_HEADERS, localRows(result.value));
  }
  return EXIT.ok;
};

const runList = async (json: boolean, here: boolean): Promise<number> => {
  if (here) {
    return runLocalList(json);
  }
  const result = await run(listCellsWithLocal, {}, 'supervisor');
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

const runStopAll = async (force: boolean, json: boolean): Promise<number> => {
  const result = await run(stopAllLocalCells, { force }, 'supervisor');
  if (result.kind !== 'ok') {
    return reportFailure(result);
  }
  if (json) {
    printJson(result.value);
  } else {
    printTable(LOCAL_HEADERS, localRows(result.value));
  }
  return EXIT.ok;
};

const runStopOne = async (
  id: string,
  force: boolean,
  json: boolean,
): Promise<number> => {
  const local = await run(stopLocalCell, { id, force }, 'supervisor');
  if (local.kind !== 'ok') {
    return reportFailure(local);
  }
  if (local.value !== null) {
    if (json) {
      printJson(local.value);
    } else {
      printLine(`cell ${local.value.slotId} ${local.value.state}`);
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

const runStop = async (
  id: string | undefined,
  options: { all: boolean; force: boolean; json: boolean },
): Promise<number> => {
  if (options.all) {
    return runStopAll(options.force, options.json);
  }
  if (id === undefined) {
    throw cliError('cell id required, or --all');
  }
  return runStopOne(id, options.force, options.json);
};

const runCreate = async (options: {
  repo: string;
  project: string | undefined;
  name: string | undefined;
  count: string;
  lines: string | undefined;
  json: boolean;
}): Promise<number> => {
  const result = await run(
    createLocalCells,
    {
      repoRoot: resolve(options.repo),
      project: options.project,
      choose: chooserOf(),
      count: Number(options.count),
      name: options.name,
      baseName: cellNameOf(hostname()),
      lines: linesOf(options.lines),
      launcher: cellWorkerLauncherOf(IS_COMPILED, process.argv[1] ?? ''),
    },
    'supervisor',
  );
  if (result.kind !== 'ok') {
    return reportFailure(result);
  }
  if (options.json) {
    printJson(result.value);
  } else {
    printTable(LOCAL_HEADERS, localRows(result.value));
  }
  return EXIT.ok;
};

const runRemove = async (slotId: string, json: boolean): Promise<number> => {
  const result = await runWithoutToken(
    removeLocalCell,
    { id: slotId },
    buildContext(),
  );
  if (result.kind !== 'ok') {
    return reportFailure(result);
  }
  if (json) {
    printJson({ slotId: result.value });
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
      description: 'Show only the local slots on this machine',
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
    description: 'Start local Cell slots on this machine',
  },
  args: {
    repo: { type: 'string', default: '.', description: 'Repository root' },
    project: {
      type: 'string',
      description:
        'Factory project id, required outside a repo with .factory/config.json',
    },
    name: { type: 'string', description: 'Slot name (count 1 only)' },
    count: { type: 'string', default: '1', description: 'Number of slots' },
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
      'Stop a Cell: local slots directly, otherwise drain it via the Factory',
  },
  args: {
    slot: { type: 'positional', required: false, description: 'Cell id' },
    id: { type: 'string', description: 'Cell id (same as the positional)' },
    all: {
      type: 'boolean',
      default: false,
      description: 'Stop every local slot',
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
  meta: { name: 'rm', description: 'Remove a stopped local slot' },
  args: {
    id: { type: 'positional', required: true, description: 'Slot id' },
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
    server: cellServerCommand,
  },
});
