import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  ProcessPort,
  SpawnedProcess,
  SpawnInput,
} from '../../ports/process.port';

const killGroup = (pid: number): void => {
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    // The group already exited.
  }
};

/**
 * Runs argv without a shell, in its own process group so a timeout kills the
 * runner's children too. Stdout and stderr go to their own files.
 */
export class BunProcessAdapter implements ProcessPort {
  spawn(input: SpawnInput): SpawnedProcess {
    mkdirSync(dirname(input.stdoutPath), { recursive: true });
    mkdirSync(dirname(input.stderrPath), { recursive: true });
    const child = Bun.spawn(input.command, {
      cwd: input.cwd,
      env: { ...process.env, ...input.env },
      stdin: 'ignore',
      stdout: Bun.file(input.stdoutPath),
      stderr: Bun.file(input.stderrPath),
      detached: true,
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup(child.pid);
    }, input.timeoutMs);
    const exit = child.exited.then(
      (exitCode) => ({ exitCode: timedOut ? null : exitCode, timedOut }),
      () => ({ exitCode: null, timedOut }),
    );
    return {
      pid: child.pid,
      exit: exit.finally(() => clearTimeout(timer)),
    };
  }

  kill(pid: number): void {
    killGroup(pid);
  }
}

export const createProcessAdapter = (): ProcessPort => {
  return new BunProcessAdapter();
};
