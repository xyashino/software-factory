import { hostname } from 'node:os';
import { resolve } from 'node:path';
import { defineCommand } from 'citty';
import { buildContext } from '../../bootstrap/context';
import { run, settle } from '../../bootstrap/run';
import { JOIN_TOKEN_ENV, cellLogPathOf } from '../../config';
import { Refused } from '../../application/core/errors';
import { startCell } from '../../application/procedures/cell/start.procedure';
import { listCells } from '../../application/procedures/cell/list.procedure';
import { revokeCell } from '../../application/procedures/cell/revoke.procedure';
import { stopCell } from '../../application/procedures/cell/stop.procedure';
import { cellNameOf } from '../../domain/cell/cell-name';
import { EXIT } from '../../domain/exit-codes';
import {
  claimCellSlot,
  migrateLegacyCellState,
  releaseCellSlot,
} from '../fs/cell-slot';
import {
  createCells,
  listCells as listLocalCells,
  removeCell as removeLocalCell,
  stopAllCells,
  stopCell as stopLocalCell,
} from '../../application/procedures/cell-server/cells.procedure';
import type { Cell } from '../../application/procedures/cell-server/shapes';
import { cellServerCommand } from './cell-server.command';
import { runCellServer } from './cell-server-run';
import { printJson, printLine, printTable, reportFailure } from './output';

const HEADERS = ['id', 'project', 'state', 'active job', 'last heartbeat'];
const SUPERSEDED_LINE =
  'cell left: the server had already moved its job, nothing handed over';
const MIGRATED_LINE = 'migrated legacy .factory-local/cell.json to this cell';

const orDash = (value: string | null): string => value ?? '-';

const heartbeatText = (ms: number | null): string =>
  ms === null ? '-' : new Date(ms).toISOString();

const cliError = (message: string): Error => {
  const error = new Error(message);
  error.name = 'CLIError';
  return error;
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

const runStart = async (requested: string | undefined): Promise<number> => {
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

const LOCAL_HEADERS = ['id', 'name', 'factory', 'state', 'pid', 'repo'];

const localSlotIds = async (): Promise<string[]> => {
  const result = await runCellServer(listLocalCells, {});
  return result.kind === 'ok' ? result.value.map((cell) => cell.slotId) : [];
};

const localRows = (cells: Cell[]): string[][] =>
  cells.map((cell) => [
    cell.slotId,
    cell.name,
    cell.factoryName,
    cell.runtimeStatus,
    cell.pid === null ? '-' : String(cell.pid),
    cell.repoRoot,
  ]);

const runLocalStopAll = async (
  force: boolean,
  json: boolean,
): Promise<number> => {
  const result = await runCellServer(stopAllCells, { force });
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

const runLocalStop = async (
  slotId: string,
  force: boolean,
  json: boolean,
): Promise<number> => {
  const result = await runCellServer(stopLocalCell, { slotId, force });
  if (result.kind !== 'ok') {
    return reportFailure(result);
  }
  if (json) {
    printJson(result.value);
  } else {
    printLine(`cell ${result.value.slotId} ${result.value.runtimeStatus}`);
  }
  return EXIT.ok;
};

const runStop = async (
  id: string | undefined,
  options: { all: boolean; force: boolean; json: boolean },
): Promise<number> => {
  if (options.all) {
    return runLocalStopAll(options.force, options.json);
  }
  if (id === undefined) {
    throw cliError('cell id required, or --all');
  }
  if ((await localSlotIds()).includes(id)) {
    return runLocalStop(id, options.force, options.json);
  }
  const result = await run(
    stopCell,
    { id, force: options.force },
    'supervisor',
  );
  if (result.kind === 'ok') {
    printLine(`cell ${result.value.cellId} ${result.value.status}`);
    return EXIT.ok;
  }
  return reportFailure(result);
};

const runList = async (json: boolean, local: boolean): Promise<number> => {
  if (local) {
    const result = await runCellServer(listLocalCells, {});
    if (result.kind !== 'ok') {
      return reportFailure(result);
    }
    if (json) {
      printJson(result.value);
    } else {
      printTable(LOCAL_HEADERS, localRows(result.value));
    }
    return EXIT.ok;
  }
  const result = await run(listCells, {}, 'supervisor');
  if (result.kind !== 'ok') {
    return reportFailure(result);
  }
  if (json) {
    printJson(result.value.rows);
    return EXIT.ok;
  }
  printTable(
    HEADERS,
    result.value.rows.map((row) => [
      row.cellId,
      row.projectId,
      row.status,
      orDash(row.activeJobId),
      heartbeatText(row.lastHeartbeatAt),
    ]),
  );
  return EXIT.ok;
};

const runCreate = async (options: {
  repo: string;
  name: string | undefined;
  count: string;
  lines: string | undefined;
  factory: string | undefined;
  json: boolean;
}): Promise<number> => {
  const result = await runCellServer(createCells, {
    repoRoot: resolve(options.repo),
    factory: options.factory,
    count: Number(options.count),
    name: options.name,
    allowedLines: options.lines?.split(',').map((line) => line.trim()),
  });
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
  const result = await runCellServer(removeLocalCell, { slotId });
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
  },
  run: async ({ args }) => {
    process.exitCode = await runStart(args.name ?? process.env.CELL_NAME);
  },
});

const listCommand = defineCommand({
  meta: { name: 'list', description: 'Show registered Cells' },
  args: {
    json: { type: 'boolean', default: false },
    local: {
      type: 'boolean',
      default: false,
      description: 'Show local slots managed by the cell server',
    },
  },
  run: async ({ args }) => {
    process.exitCode = await runList(args.json, args.local);
  },
});

const createCommand = defineCommand({
  meta: {
    name: 'create',
    description: 'Start local Cell slots through the cell server',
  },
  args: {
    repo: { type: 'string', default: '.', description: 'Repository root' },
    name: { type: 'string', description: 'Slot name (count 1 only)' },
    count: { type: 'string', default: '1', description: 'Number of slots' },
    lines: { type: 'string', description: 'Comma-separated line names' },
    factory: { type: 'string', description: 'Saved Factory target name' },
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
      'Drain a Cell: local slots via the cell server, otherwise via the Factory',
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
