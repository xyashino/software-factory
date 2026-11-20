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
import { printJson, printLine, printTable, reportFailure } from './output';

const HEADERS = ['id', 'project', 'state', 'active job', 'last heartbeat'];
const SUPERSEDED_LINE =
  'cell left: the server had already moved its job, nothing handed over';
const MIGRATED_LINE = 'migrated legacy .factory-local/cell.json to this cell';

const orDash = (value: string | null): string => value ?? '-';

const heartbeatText = (ms: number | null): string =>
  ms === null ? '-' : new Date(ms).toISOString();

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

const runStop = async (id: string, force: boolean): Promise<number> => {
  const result = await run(stopCell, { id, force }, 'supervisor');
  if (result.kind === 'ok') {
    printLine(`cell ${result.value.cellId} ${result.value.status}`);
    return EXIT.ok;
  }
  return reportFailure(result);
};

const runList = async (json: boolean): Promise<number> => {
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
    process.exitCode = await runStart(args.name);
  },
});

const listCommand = defineCommand({
  meta: { name: 'list', description: 'Show registered Cells' },
  args: {
    json: { type: 'boolean', default: false },
  },
  run: async ({ args }) => {
    process.exitCode = await runList(args.json);
  },
});

const stopCommand = defineCommand({
  meta: {
    name: 'stop',
    description:
      'Drain a Cell: it finishes its station, then leaves (returns at once)',
  },
  args: {
    id: { type: 'string', required: true, description: 'Cell id' },
    force: {
      type: 'boolean',
      default: false,
      description: 'Abort the running station and hand its Job over now',
    },
  },
  run: async ({ args }) => {
    process.exitCode = await runStop(args.id, args.force);
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
  },
});
