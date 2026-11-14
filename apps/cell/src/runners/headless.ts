import { spawn } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import type { HeadlessProcess, LaunchSpec, SpawnHeadless } from '../ports';

/**
 * Starts a headless Operator: its stdout and stderr go to the Cycle's log files, its stdin takes the
 * typed signals. The Cell keeps the process in view through `alive` and ends it with `stop`.
 */
export const spawnHeadless: SpawnHeadless = (
  spec: LaunchSpec,
): HeadlessProcess => {
  const out = openSync(spec.stdoutPath, 'a');
  const err = openSync(spec.stderrPath, 'a');
  const [binary, ...args] = spec.command;
  if (binary === undefined) throw new Error('headless launch names no command');
  const child = spawn(binary, args, {
    cwd: spec.cwd,
    env: { ...spec.env },
    stdio: ['pipe', out, err],
  });
  let alive = true;
  const exit = new Promise<number | null>((resolve) => {
    const done = (code: number | null): void => {
      if (!alive) return;
      alive = false;
      closeSync(out);
      closeSync(err);
      resolve(code);
    };
    child.once('close', (code) => done(code));
    child.once('error', () => done(null));
  });
  return {
    pid: child.pid ?? -1,
    alive: () => alive,
    exit,
    type: (text: string) => {
      if (alive && child.stdin?.writable) child.stdin.write(`${text}\n`);
    },
    stop: () => {
      if (alive) child.kill('SIGTERM');
    },
  };
};
