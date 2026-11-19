import { hostname } from 'node:os';
import { defineCommand } from 'citty';
import { buildContext } from '../../bootstrap/context';
import { run, settle } from '../../bootstrap/run';
import { JOIN_TOKEN_ENV } from '../../config';
import { startCell } from '../../application/procedures/cell/start.procedure';
import { listCells } from '../../application/procedures/cell/list.procedure';
import { revokeCell } from '../../application/procedures/cell/revoke.procedure';
import { EXIT } from '../../domain/exit-codes';
import { printJson, printLine, printTable, reportFailure } from './output';

const HEADERS = ['id', 'project', 'state', 'active job', 'last heartbeat'];

const orDash = (value: string | null): string => value ?? '-';

const heartbeatText = (ms: number | null): string =>
  ms === null ? '-' : new Date(ms).toISOString();

const runStart = async (): Promise<number> => {
  const controller = new AbortController();
  const stop = (): void => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  const result = await settle(() =>
    startCell(buildContext(), {
      repoRoot: process.cwd(),
      cellName: hostname(),
      joinToken: process.env[JOIN_TOKEN_ENV],
      runner: null,
      signal: controller.signal,
    }),
  );
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
  run: async () => {
    process.exitCode = await runStart();
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
    revoke: revokeCommand,
  },
});
