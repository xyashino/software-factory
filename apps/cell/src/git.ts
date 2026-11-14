import { execFile } from 'node:child_process';
import type { GitResult, RunGit } from './ports';

/** Git identity of the Cell's own commits: a checkpoint is authored by the Cell, not a person. */
const IDENTITY = [
  '-c',
  'user.name=factory-cell',
  '-c',
  'user.email=cell@factory.invalid',
] as const;

/**
 * The real git adapter: one `git` process per call, arguments as a vector, no shell. The
 * terminal prompt is off so a missing credential fails instead of waiting.
 */
export const runGit: RunGit = (cwd, args, env = {}) =>
  new Promise<GitResult>((resolve) => {
    execFile(
      'git',
      [...IDENTITY, ...args],
      {
        cwd,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...env },
        maxBuffer: 64 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        const code =
          error === null ? 0 : typeof error.code === 'number' ? error.code : 1;
        resolve({ code, stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
