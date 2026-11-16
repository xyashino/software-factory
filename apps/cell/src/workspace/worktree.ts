import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { gitIn, GIT_TIMEOUT_MS } from './repo';
import { succeeded, type ShellContext, type ShellRun } from './shell';

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
 * Whether a worktree is on this Cell: its directory holds git's link file. A `reuse` job checks this and
 * nothing more; a directory without the link is not a worktree, so it counts as missing.
 */
export const worktreePresent = (path: string): boolean =>
  existsSync(join(path, '.git'));

/** Removes a worktree: git's record and its directory. A directory git no longer knows is removed too. */
export const removeWorktree = async (
  ctx: ShellContext,
  input: { repoRoot: string; path: string; timeoutMs?: number },
): Promise<ShellRun> => {
  const timeoutMs = input.timeoutMs ?? GIT_TIMEOUT_MS;
  const removed = await gitIn(
    ctx,
    input.repoRoot,
    ['worktree', 'remove', '--force', input.path],
    timeoutMs,
  );
  rmSync(input.path, { recursive: true, force: true });
  await gitIn(ctx, input.repoRoot, ['worktree', 'prune'], timeoutMs);
  return removed;
};

/**
 * Puts the worktree at `commit` on the named branch `branch` (`factory/<todoId>`), under the repo lock. `-B`
 * creates the branch or resets one an evicted worktree left behind, so no branch-exists error comes up. A
 * worktree git still knows is reset to the commit with its untracked files removed; `node_modules` and the
 * `.cell/` marker are gitignored, so they survive. A worktree that cannot be reset is removed and created
 * again. Returns the run that failed, or null.
 */
export const ensureWorktree = async (
  ctx: ShellContext,
  input: {
    repoRoot: string;
    path: string;
    branch: string;
    commit: string;
    timeoutMs: number;
  },
): Promise<ShellRun | null> => {
  const { repoRoot, path, branch, commit, timeoutMs } = input;
  if (existsSync(join(path, '.git'))) {
    const checkedOut = await gitIn(
      ctx,
      path,
      ['checkout', '--force', '-B', branch, commit],
      timeoutMs,
    );
    if (succeeded(checkedOut)) {
      const cleaned = await gitIn(ctx, path, ['clean', '-fd'], timeoutMs);
      if (succeeded(cleaned)) return null;
    }
    await removeWorktree(ctx, { repoRoot, path, timeoutMs });
  }

  // A directory git does not know (a half-made worktree) is cleared before `worktree add` takes its place.
  rmSync(path, { recursive: true, force: true });
  mkdirSync(dirname(path), { recursive: true });
  await gitIn(ctx, repoRoot, ['worktree', 'prune'], timeoutMs);
  const added = await gitIn(
    ctx,
    repoRoot,
    ['worktree', 'add', '-B', branch, path, commit],
    timeoutMs,
  );
  return succeeded(added) ? null : added;
};
