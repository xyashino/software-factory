import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  RunHandle,
  RunnerPort,
  RunOutcome,
  RunSpec,
} from '../../application/ports/runner.port';

const KILL_AFTER_MS = 5_000;
const SPAWN_FAILED_EXIT = 127;
const IS_WINDOWS = process.platform === 'win32';

interface HeadlessRun {
  exit: Promise<number>;
  stop: () => Promise<boolean>;
  pid: number | undefined;
}

const spawnHeadless = (spec: RunSpec): HeadlessRun => {
  mkdirSync(dirname(spec.logPath), { recursive: true });
  const log = openSync(spec.logPath, 'a');
  // Own process group, so the signal reaches the agent's children too.
  const child = spawn(spec.command, spec.args, {
    cwd: spec.cwd,
    env: { ...process.env, ...spec.env },
    stdio: ['ignore', log, log],
    detached: !IS_WINDOWS,
  });
  closeSync(log);
  let exited = false;
  const exit = new Promise<number>((resolve) => {
    const settle = (code: number): void => {
      exited = true;
      resolve(code);
    };
    child.once('error', () => settle(SPAWN_FAILED_EXIT));
    child.once('close', (code) => settle(code ?? -1));
  });
  const { pid } = child;
  const signalTree = (signal: NodeJS.Signals): void => {
    if (pid === undefined) return;
    try {
      process.kill(IS_WINDOWS ? pid : -pid, signal);
    } catch {
      child.kill(signal);
    }
  };
  const exitWithin = (ms: number): Promise<boolean> =>
    new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), ms);
      void exit.then(() => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  return {
    exit,
    stop: async () => {
      if (exited) return true;
      signalTree('SIGTERM');
      if (await exitWithin(KILL_AFTER_MS)) return true;
      signalTree('SIGKILL');
      return exitWithin(KILL_AFTER_MS);
    },
    pid,
  };
};

export const createHeadlessRunner = (): RunnerPort => {
  const runs = new Map<string, HeadlessRun>();
  let started = 0;
  return {
    prepare: async () => undefined,
    start: async (spec: RunSpec): Promise<RunHandle> => {
      started += 1;
      const id = `headless-${started}`;
      const run = spawnHeadless(spec);
      runs.set(id, run);
      return { id, pid: run.pid };
    },
    abort: async (handle) => runs.get(handle.id)?.stop() ?? true,
    wait: async (handle): Promise<RunOutcome> => {
      const run = runs.get(handle.id);
      if (run === undefined) throw new Error(`unknown run ${handle.id}`);
      const exitCode = await run.exit;
      runs.delete(handle.id);
      return { exitCode };
    },
    interactiveAvailable: async () => false,
  };
};
