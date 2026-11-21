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

interface HeadlessRun {
  exit: Promise<number>;
  abort: () => void;
}

const spawnHeadless = (spec: RunSpec): HeadlessRun => {
  mkdirSync(dirname(spec.logPath), { recursive: true });
  const log = openSync(spec.logPath, 'a');
  const child = spawn(spec.command, spec.args, {
    cwd: spec.cwd,
    env: { ...process.env, ...spec.env },
    stdio: ['ignore', log, log],
  });
  closeSync(log);
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const exit = new Promise<number>((resolve) => {
    const settle = (code: number): void => {
      clearTimeout(killTimer);
      resolve(code);
    };
    child.once('error', () => settle(SPAWN_FAILED_EXIT));
    child.once('close', (code) => settle(code ?? -1));
  });
  return {
    exit,
    abort: () => {
      child.kill('SIGTERM');
      killTimer ??= setTimeout(() => child.kill('SIGKILL'), KILL_AFTER_MS);
    },
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
      runs.set(id, spawnHeadless(spec));
      return { id };
    },
    abort: async (handle) => {
      runs.get(handle.id)?.abort();
    },
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
