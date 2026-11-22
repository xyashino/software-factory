import { hostname } from 'node:os';
import { resolve } from 'node:path';
import { defineCommand } from 'citty';
import { buildContext } from '../../bootstrap/context';
import { run, runWithoutToken, settle } from '../../bootstrap/run';
import {
  CELL_LINES_ENV,
  FACTORY_CELL_ID_ENV,
  FACTORY_PID_ENV,
  JOIN_TOKEN_ENV,
  cellLogPathOf,
  isRelayedOf,
} from '../../config';
import { Refused } from '../../application/core/errors';
import type { Ports } from '../../application/core/procedure';
import { startCell } from '../../application/procedures/cell/start.procedure';
import {
  type FactoryProject,
  listFactoryProjects,
} from '../../application/procedures/cell/factory-cells';
import { revokeCell } from '../../application/procedures/cell/revoke.procedure';
import { scaleCells } from '../../application/procedures/cell/scale.procedure';
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

const PROJECT_HEADERS = [
  'project',
  'repo',
  'desired',
  'running',
  'cell',
  'state',
  'flag',
];
const SUPERSEDED_LINE =
  'cell left: the server had already moved its job, nothing handed over';
const MIGRATED_LINE = 'migrated legacy .factory-local/cell.json to this cell';
const FORCED_STOP_LINE =
  'cell stopped by a second signal: exiting now, a runner may still be alive';
const FORCED_STOP_EXIT = 130;
const PARENT_GONE_LINE = 'factory daemon is gone: stopping this cell';
const PARENT_GONE_EXIT = 1;
const DAEMON_WATCH_MS = 1_000;
// A claim long-polls and only sees the abort when it returns, so the exit is forced.
const PARENT_GONE_GRACE_MS = 1_000;
const CRASH_LOOP_FLAG = 'crash loop';
const COUNT_PATTERN = /^\d+$/;

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
        signal: controller.signal,
        daemonCellId: process.env[FACTORY_CELL_ID_ENV],
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

const projectRows = (projects: FactoryProject[]): string[][] =>
  projects.flatMap((project) => {
    const head = [
      project.projectId,
      project.repoRoot,
      String(project.desired),
      String(project.running),
    ];
    const flag = project.crashLoop ? CRASH_LOOP_FLAG : '-';
    if (project.cells.length === 0) {
      return [[...head, '-', '-', flag]];
    }
    return project.cells.map((cell) => [
      ...head,
      cell.cellId,
      cell.state,
      flag,
    ]);
  });

const runList = async (json: boolean): Promise<number> => {
  const result = await runWithoutToken(listFactoryProjects, {}, () =>
    buildContext(),
  );
  if (result.kind !== 'ok') {
    return reportFailure(result);
  }
  if (json) {
    printJson(result.value);
  } else {
    printTable(PROJECT_HEADERS, projectRows(result.value));
  }
  return EXIT.ok;
};

const runScale = async (
  count: string,
  lines: string | undefined,
  json: boolean,
): Promise<number> => {
  if (!COUNT_PATTERN.test(count)) {
    printError('count must be an integer >= 0');
    return EXIT.argument;
  }
  const result = await run(
    scaleCells,
    { cwd: process.cwd(), count: Number(count), lines: linesOf(lines) },
    'supervisor',
  );
  if (result.kind !== 'ok') {
    return reportFailure(result);
  }
  if (json) {
    printJson(result.value);
  } else {
    printLine(
      `${result.value.projectId}: ${result.value.count} cell(s) at ${result.value.repoRoot}`,
    );
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
      description: 'Factory project id, must match the repo config',
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
    description: 'Show the Cells per project on the local Factory daemon',
  },
  args: {
    json: { type: 'boolean', default: false },
  },
  run: async ({ args }) => {
    process.exitCode = await runList(args.json);
  },
});

const scaleCommand = defineCommand({
  meta: {
    name: 'scale',
    description:
      'Run N Cells for the repo project on this PC (0 stops them all)',
  },
  args: {
    count: {
      type: 'positional',
      required: true,
      description: 'Number of Cells, an integer >= 0',
    },
    lines: { type: 'string', description: 'Comma-separated line names' },
    json: { type: 'boolean', default: false },
  },
  run: async ({ args }) => {
    process.exitCode = await runScale(args.count, args.lines, args.json);
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
    scale: scaleCommand,
    revoke: revokeCommand,
  },
});
