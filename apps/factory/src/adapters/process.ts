import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import { dirname } from 'node:path';
import { Unreachable } from '../errors';
import type { DetachedSpec, ProcessPort } from '../ports';

const isPermissionError = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === 'EPERM';

export const createProcessAdapter = (): ProcessPort => ({
  spawnDetached: async ({ command, args, env, logPath, cwd }: DetachedSpec) => {
    mkdirSync(dirname(logPath), { recursive: true });
    const logFd = openSync(logPath, 'a');
    const child = spawn(command, args, {
      cwd,
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env: { ...process.env, ...env },
      windowsHide: true,
    });
    child.on('error', () => undefined);
    child.unref();
    closeSync(logFd);
    if (child.pid === undefined) {
      throw new Unreachable('process did not start');
    }
    return child.pid;
  },
  isAlive: (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return isPermissionError(error);
    }
  },
  terminate: (pid) => {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      return;
    }
  },
  forceKill: (pid) => {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      return;
    }
  },
});
