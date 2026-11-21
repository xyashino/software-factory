import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import { dirname } from 'node:path';
import { Unreachable } from '../../application/core/errors';
import type {
  DetachedSpec,
  ProcessPort,
  ProcessResult,
} from '../../application/ports/process.port';

const SPAWN_FAILED_EXIT = 127;
const PROBE_TIMEOUT_MS = 1_000;

const collect = (
  command: string,
  args: readonly string[],
  cwd: string,
  env: Readonly<Record<string, string>>,
): Promise<ProcessResult> =>
  new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      resolve({ exitCode: SPAWN_FAILED_EXIT, stdout, stderr: error.message });
    });
    child.on('close', (code) => {
      resolve({ exitCode: code ?? SPAWN_FAILED_EXIT, stdout, stderr });
    });
  });

const isPermissionError = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === 'EPERM';

export const createProcessAdapter = (): ProcessPort => ({
  run: collect,
  spawnDetached: async ({ command, args, env, logPath }: DetachedSpec) => {
    mkdirSync(dirname(logPath), { recursive: true });
    const logFd = openSync(logPath, 'a');
    const child = spawn(command, args, {
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
  probeUrl: async (url) => {
    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      await response.body?.cancel();
      return true;
    } catch {
      return false;
    }
  },
});
