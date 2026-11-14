import { mkdirSync, openSync, closeSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
import type { CommandResult, SystemPort } from '../../ports/system.port';

/** Closes the log file descriptor even when the process fails to spawn. */
const withLog = <T>(
  logPath: string,
  body: (fd: number) => Promise<T>,
): Promise<T> => {
  mkdirSync(dirname(logPath), { recursive: true });
  const fd = openSync(logPath, 'w');
  return body(fd).finally(() => closeSync(fd));
};

/**
 * Runs shell commands through `bash -lc` in their own process group. Stdout and
 * stderr are written interleaved, in arrival order, to `logPath`. On timeout the
 * whole group is killed, so child processes cannot outlive the step.
 */
export class BunSystemAdapter implements SystemPort {
  run(input: {
    command: string;
    cwd: string;
    timeoutMs: number;
    logPath: string;
    signal?: AbortSignal;
  }): Promise<CommandResult> {
    return withLog(input.logPath, (fd) => this.spawnAndWait(input, fd));
  }

  private async spawnAndWait(
    input: {
      command: string;
      cwd: string;
      timeoutMs: number;
      signal?: AbortSignal;
    },
    fd: number,
  ): Promise<CommandResult> {
    const started = Date.now();
    const child = Bun.spawn(['bash', '-lc', input.command], {
      cwd: input.cwd,
      stdout: 'pipe',
      stderr: 'pipe',
      detached: true,
    });

    const pumps = Promise.all([pump(child.stdout, fd), pump(child.stderr, fd)]);

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup(child.pid);
    }, input.timeoutMs);
    const onAbort = (): void => killGroup(child.pid);
    if (input.signal?.aborted) onAbort();
    input.signal?.addEventListener('abort', onAbort, { once: true });

    try {
      const exitCode = await child.exited;
      await pumps;
      return {
        exitCode: timedOut ? null : exitCode,
        timedOut,
        durationMs: Date.now() - started,
      };
    } finally {
      clearTimeout(timer);
      input.signal?.removeEventListener('abort', onAbort);
    }
  }
}

const killGroup = (pid: number): void => {
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    // The group already exited between the timer firing and the kill.
  }
};

/** Copies a child stream into the log as chunks arrive. */
const pump = async (
  stream: ReadableStream<Uint8Array> | null | undefined,
  fd: number,
): Promise<void> => {
  if (!stream) return;
  const reader = stream.getReader();
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) return;
    writeSync(fd, chunk.value);
  }
};

export const createSystemAdapter = (): SystemPort => {
  return new BunSystemAdapter();
};
