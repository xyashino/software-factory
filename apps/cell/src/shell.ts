import { execFile } from 'node:child_process';
import type { RunShell } from './ports';

/**
 * The real shell adapter for a Job's `sync` and `setup` lines: `sh -c` in the directory, bounded by
 * the timeout. The lines come from the Work order's own definition, the same trust as the
 * Supervisor's config (PROTOCOL §4), and are never built from Operator output.
 */
export const runShell: RunShell = (cwd, command, timeoutMs) =>
  new Promise((resolve) => {
    execFile(
      '/bin/sh',
      ['-c', command],
      { cwd, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ ok: true, detail: '' });
          return;
        }
        const detail = error.killed
          ? `timed out after ${timeoutMs} ms`
          : stderr.trim() ||
            stdout.trim() ||
            `exited with ${String(error.code ?? 'a signal')}`;
        resolve({ ok: false, detail });
      },
    );
  });
