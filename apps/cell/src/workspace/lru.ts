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
 * What eviction may do under `root`: `excess` worktrees must go to get down to `limit`, and `candidates` are
 * the ones it may remove, least recently used first. A worktree in `keep` (a job of this Cell is using it)
 * is never a candidate. The caller removes candidates until `excess` are gone, skipping any that another
 * Cell instance holds.
 */
export const evictionPlan = (input: {
  root: string;
  limit: number;
  keep: ReadonlySet<string>;
}): { excess: number; candidates: string[] } => {
  const worktrees = listWorktreeUse(input.root);
  const excess = worktrees.length - input.limit;
  if (excess <= 0) return { excess: 0, candidates: [] };
  return {
    excess,
    candidates: worktrees
      .filter((worktree) => !input.keep.has(worktree.path))
      .map((worktree) => worktree.path),
  };
};
