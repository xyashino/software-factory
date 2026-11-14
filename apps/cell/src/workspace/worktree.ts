import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import {
  gitCommand,
  runShell,
  succeeded,
  type ShellContext,
  type ShellRun,
} from './shell';

/** The worktrees of one mirror live under one directory, so eviction can work per repo. */
export const worktreeRootOf = (
  cellDataDir: string,
  mirrorPath: string,
): string => join(cellDataDir, 'worktrees', basename(mirrorPath, '.git'));

/**
 * The directory of a job's worktree: `workspace.dir` resolved under the root. A path that climbs out
 * of the root is refused (the contract already refuses `..`; this is the second check at the disk).
 */
export const worktreePathOf = (root: string, dir: string): string => {
  const path = resolve(root, dir);
  if (path === root || !path.startsWith(root + sep)) {
    throw new Error(`workspace dir ${dir} escapes the worktree root`);
  }
  return path;
};

/**
 * Puts the worktree at `commit`, detached. A worktree that exists is reset to the commit and has its
 * untracked files removed; `node_modules` and the `.cell/` marker are gitignored, so they survive.
 * Returns the run that failed, or null.
 */
export const ensureWorktree = async (
  ctx: ShellContext,
  input: { mirror: string; path: string; commit: string; timeoutMs: number },
): Promise<ShellRun | null> => {
  const { mirror, path, commit, timeoutMs } = input;
  const steps: string[][] = existsSync(join(path, '.git'))
    ? [
        ['-C', path, 'checkout', '--force', '--detach', commit],
        ['-C', path, 'clean', '-fd'],
      ]
    : [
        ['-C', mirror, 'worktree', 'prune'],
        ['-C', mirror, 'worktree', 'add', '--detach', path, commit],
      ];
  if (!existsSync(join(path, '.git'))) {
    rmSync(path, { recursive: true, force: true });
    mkdirSync(dirname(path), { recursive: true });
  }
  for (const args of steps) {
    const run = await runShell(ctx, {
      command: gitCommand(args),
      cwd: mirror,
      timeoutMs,
    });
    if (!succeeded(run)) return run;
  }
  return null;
};

/** Removes a worktree's directory and drops its git record from the mirror. */
export const removeWorktree = async (
  ctx: ShellContext,
  input: { mirror: string; path: string; timeoutMs: number },
): Promise<void> => {
  rmSync(input.path, { recursive: true, force: true });
  await runShell(ctx, {
    command: gitCommand(['-C', input.mirror, 'worktree', 'prune']),
    cwd: input.mirror,
    timeoutMs: input.timeoutMs,
  });
};
