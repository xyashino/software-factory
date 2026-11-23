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
  type FactoryProject,
  listFactoryProjects,
  scaleFactoryCells,
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

const PROJECT_HEADERS = [
  'project',
  'repo',
  'desired',
  'running',
  'cell',
  'state',
  'flag',
];
const CRASH_LOOP_FLAG = 'crash loop';
const COUNT_PATTERN = /^\d+$/;
const FORCED_STOP_LINE =
  'cell stopped by a second signal: exiting now, a runner may still be alive';
const FORCED_STOP_EXIT = 130;
const PARENT_GONE_LINE = 'factory daemon is gone: stopping this cell';
const PARENT_GONE_EXIT = 1;
const DAEMON_WATCH_MS = 1_000;
// A claim long-polls and only sees the abort when it returns, so the exit is forced.
const PARENT_GONE_GRACE_MS = 1_000;

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

const runStart = async (requested: string | undefined): Promise<number> => {
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
        signal: controller.signal,
      }),
    );
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
  repo: string,
  lines: string | undefined,
  json: boolean,
): Promise<number> => {
  if (!COUNT_PATTERN.test(count)) {
    printError('count must be an integer >= 0');
    return EXIT.argument;
  }
  const result = await runWithoutToken(
    scaleFactoryCells,
    { repoRoot: resolve(repo), count: Number(count), lines: linesOf(lines) },
    () => buildContext(),
  );
  if (result.kind !== 'ok') {
    return reportFailure(result);
  }
  if (json) {
    printJson(result.value);
  } else {
    printLine(`project ${result.value.projectId} scaled to ${count}`);
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
  },
  run: async ({ args }) => {
    process.exitCode = await runStart(args.name ?? process.env.CELL_NAME);
  },
});

const listCommand = defineCommand({
  meta: {
    name: 'list',
    description: 'Show the projects and Cells of the local Factory daemon',
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
    description: 'Set how many Cells run for this repo project on this PC',
  },
  args: {
    count: {
      type: 'positional',
      required: true,
      description: 'Desired Cell count (0 stops all)',
    },
    repo: { type: 'string', default: '.', description: 'Repository root' },
    lines: { type: 'string', description: 'Comma-separated line names' },
    json: { type: 'boolean', default: false },
  },
  run: async ({ args }) => {
    process.exitCode = await runScale(
      args.count,
      args.repo,
      args.lines,
      args.json,
    );
  },
});

const removedCommand = (name: string) =>
  defineCommand({
    meta: { name, description: 'Removed: use "sf cell scale N"' },
    args: {
      target: { type: 'positional', required: false },
      id: { type: 'string' },
      all: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      repo: { type: 'string' },
      name: { type: 'string' },
      count: { type: 'string' },
      lines: { type: 'string' },
    },
    run: () => {
      printError(`"sf cell ${name}" was removed: use "sf cell scale N"`);
      process.exitCode = EXIT.argument;
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
    create: removedCommand('create'),
    stop: removedCommand('stop'),
    rm: removedCommand('rm'),
  },
});
