import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  gitCommand,
  runShell,
  succeeded,
  textOf,
  type ShellContext,
  type ShellRun,
} from './shell';

/** Git operations on the repo may take this long; a fetch is the slow one. */
export const GIT_TIMEOUT_MS = 120_000;

/**
 * The lines the repo's common `info/exclude` must hold, so a repo that does not ignore them still shows a
 * clean status: `.cell/` keeps a Cell's scratch out of every worktree (PROTOCOL §4), `.worktrees/` keeps the
 * worktrees out of the checkout, and `.factory-local/` keeps the Cell's data and locks out of it.
 */
export const CELL_EXCLUDE_LINES = [
  '.cell/',
  '.worktrees/',
  '.factory-local/',
] as const;

/**
 * The directory where job worktrees live: `<repoRoot>/.worktrees/<dir>`. It is gitignored, so the
 * checkout's status stays clean, and `git worktree list` in the repo shows every active worktree.
 */
export const worktreesRootOf = (repoRoot: string): string =>
  resolve(repoRoot, '.worktrees');

/** Runs one git command against the repo at `repoRoot` (`git -C <repoRoot> ...`). */
export const gitIn = (
  ctx: ShellContext,
  repoRoot: string,
  args: readonly string[],
  timeoutMs: number = GIT_TIMEOUT_MS,
): Promise<ShellRun> =>
  runShell(ctx, {
    command: gitCommand(['-C', repoRoot, ...args]),
    cwd: repoRoot,
    timeoutMs,
  });

/**
 * Adds the `CELL_EXCLUDE_LINES` to the repo's common `info/exclude`, each once. The common git dir is shared
 * by every worktree of the repo, so the lines apply to all of them. Call it under the repo lock.
 */
export const ensureCellExcluded = async (
  ctx: ShellContext,
  repoRoot: string,
): Promise<ShellRun> => {
  const common = await gitIn(ctx, repoRoot, ['rev-parse', '--git-common-dir']);
  if (!succeeded(common)) return common;
  const file = join(
    resolve(repoRoot, textOf(common).trim()),
    'info',
    'exclude',
  );
  mkdirSync(dirname(file), { recursive: true });
  const current = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const lines = current.split('\n');
  const missing = CELL_EXCLUDE_LINES.filter((line) => !lines.includes(line));
  if (missing.length > 0) {
    const separator = current === '' || current.endsWith('\n') ? '' : '\n';
    writeFileSync(file, `${current}${separator}${missing.join('\n')}\n`);
  }
  return common;
};
