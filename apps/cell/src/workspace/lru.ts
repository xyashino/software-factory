import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** The file a prepare touches, so the worktree's last use is its mtime. */
export const USED_MARKER = join('.cell', 'used');

export interface WorktreeUse {
  path: string;
  usedAt: number;
}

/** Worktrees under `root` with their last use, oldest first. */
export const listWorktreeUse = (root: string): WorktreeUse[] => {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const path = join(root, entry.name);
      const marker = join(path, USED_MARKER);
      const stamp = existsSync(marker) ? marker : path;
      return { path, usedAt: statSync(stamp).mtimeMs };
    })
    .sort((a, b) => a.usedAt - b.usedAt);
};

/**
 * Picks the worktrees to evict so that at most `limit` remain: the least recently used first, never one
 * in `keep` (a worktree a job is using now). Returns the paths to remove; the caller removes them.
 */
export const pickEvictions = (input: {
  root: string;
  limit: number;
  keep: ReadonlySet<string>;
}): string[] => {
  const worktrees = listWorktreeUse(input.root);
  const excess = worktrees.length - input.limit;
  if (excess <= 0) return [];
  return worktrees
    .filter((worktree) => !input.keep.has(worktree.path))
    .slice(0, excess)
    .map((worktree) => worktree.path);
};
