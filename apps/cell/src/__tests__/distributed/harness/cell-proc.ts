import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CellId } from '@repo/factory-core/ids';
import {
  captureOutput,
  inheritedEnv,
  signalGroup,
  signalPid,
  spawnGroup,
  waitFor,
  type OutputCapture,
} from './process';

/** The `factory-cell` entry point, run as a real process. */
const CELL_MAIN = fileURLToPath(new URL('../../../main.ts', import.meta.url));

/** The Cell's own directory layout inside one test root: its config home and its data home. */
export interface CellPaths {
  configHome: string;
  dataHome: string;
  cellDataDir: string;
}

export const cellPathsIn = (root: string): CellPaths => ({
  configHome: join(root, 'config'),
  dataHome: join(root, 'share'),
  cellDataDir: join(root, 'share', 'factory-cell'),
});

/** The fake runner's log of one Cell: every runner it started, one JSON line each. */
export const runLogOf = (root: string): string => join(root, 'runs.log');

/** One runner the fake runner started: its role, the scenario it played and its prompt. */
export interface RunRecord {
  role: string;
  scenario: string;
  promptPath: string;
  pid: number;
}

/** Whether a process is still alive (signal 0 probes it without sending anything). */
export const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
};

/** Every run of one Cell, in order (the fake runner's log). */
export const runsIn = (root: string): RunRecord[] => {
  const log = runLogOf(root);
  if (!existsSync(log)) return [];
  return readFileSync(log, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as RunRecord);
};

export interface CellOptions {
  /** The Cell's directory root: its config, identity and worktrees. */
  root: string;
  /** Local mode: the data directory whose discovery file (`server.json`) names the Factory to talk to. */
  factoryDataDir?: string;
  /** Remote mode: the Factory's HTTP address, through whatever proxy the test puts there. */
  factoryUrl?: string;
  /** Remote mode: the join token, given to the process as `FACTORY_JOIN_TOKEN`. */
  joinToken?: string;
  /** Runner scenarios by role, read by the fake runner (`FAKE_RUNNER_SCENARIOS`). */
  scenarios?: Record<string, string | string[]>;
  /** The fake `gh` state directory and the fake runner shims' directory, on PATH. */
  ghDir: string;
  fakeBin: string;
  /** Extra environment, for example the suite's knobs. */
  env?: Record<string, string>;
}

/** A `factory-cell` process of the suite. */
export interface RunningCell {
  readonly name: string;
  readonly root: string;
  /** The Cell's id, read from its start line; set once the Cell has said hello. */
  readonly cellId: CellId;
  /** Everything the process printed so far. */
  output(): string;
  /** Sends SIGKILL to the Cell and its runner (the whole group) and waits for them to exit. */
  kill9(): Promise<void>;
  /** Sends SIGTERM (a graceful leave) and resolves with the exit code once the Cell has exited. */
  term(): Promise<number>;
  /** Sends SIGINT (stop now) and waits for the exit. */
  interrupt(): Promise<number>;
  /** Resolves once the process has exited, with its code. */
  exitCode(): Promise<number>;
  /** Whether the process is still running. */
  alive(): boolean;
}

const START_LINE = /factory-cell: running as (\S+)/;

/** Writes the Cell's config and starts it. Resolves once the Cell has said hello and runs its claim loop. */
export const startCell = async (
  name: string,
  options: CellOptions,
): Promise<RunningCell> => {
  const paths = cellPathsIn(options.root);
  const config = [
    'projects = ["software-factory"]',
    'runners = ["claude", "cursor"]',
    'headless_operators = true',
    `cell_data_dir = "${paths.cellDataDir}"`,
    ...(options.factoryUrl === undefined
      ? [`factory_data_dir = "${options.factoryDataDir}"`]
      : [`factory_url = "${options.factoryUrl}"`]),
    '',
  ].join('\n');
  await Bun.write(
    join(paths.configHome, 'factory-cell', 'config.toml'),
    config,
  );

  const env: Record<string, string> = {
    ...inheritedEnv(),
    PATH: `${options.fakeBin}:${process.env.PATH ?? ''}`,
    XDG_CONFIG_HOME: paths.configHome,
    XDG_DATA_HOME: paths.dataHome,
    FAKE_GH_DIR: options.ghDir,
    FAKE_RUNNER_LOG: runLogOf(options.root),
    FAKE_RUNNER_SCENARIOS: JSON.stringify(options.scenarios ?? {}),
    ...(options.joinToken === undefined
      ? {}
      : { FACTORY_JOIN_TOKEN: options.joinToken }),
    ...(options.env ?? {}),
  };
  const child = spawnGroup(['bun', CELL_MAIN], env);
  const output: OutputCapture = captureOutput(child.stdout);
  const errors: OutputCapture = captureOutput(child.stderr);
  let exited = false;
  const exit = child.exited.then((code) => {
    exited = true;
    return code;
  });

  let cellId = '' as CellId;
  await waitFor(() => {
    const match = START_LINE.exec(output.text());
    if (match?.[1]) cellId = match[1] as CellId;
    if (exited) {
      throw new Error(
        `factory-cell ${name} exited before it started:\n${output.text()}${errors.text()}`,
      );
    }
    return cellId !== '';
  }, `factory-cell ${name} to start`);

  return {
    name,
    root: options.root,
    cellId,
    output: () => output.text() + errors.text(),
    async kill9() {
      if (!exited) signalGroup(child.pid, 'SIGKILL');
      await exit;
    },
    async term() {
      if (!exited) signalPid(child.pid, 'SIGTERM');
      return exit;
    },
    async interrupt() {
      if (!exited) signalPid(child.pid, 'SIGINT');
      return exit;
    },
    exitCode: () => exit,
    alive: () => !exited,
  };
};
