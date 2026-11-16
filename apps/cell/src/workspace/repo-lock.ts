import { createHash } from 'node:crypto';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tryLockExclusive, unlockFd } from '../flock';

/**
 * A held lock. `release` drops the flock and closes its descriptor; it is idempotent.
 */
export interface Lease {
  release(): void;
}

/** How long a waiting prepare sleeps between tries of the repo lock. */
const LOCK_POLL_MS = 50;

/** The lock files of a Cell's repo: under `<repoRoot>/.factory-local/`, which the repo ignores. */
const LOCK_DIR = join('.factory-local', 'locks');

/** Opens a lock file (creating its directory) and tries the exclusive flock once. */
const tryLock = (file: string): Lease | undefined => {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const fd = openSync(file, 'a+', 0o600);
  if (!tryLockExclusive(fd)) {
    closeSync(fd);
    return undefined;
  }
  let held = true;
  return {
    release() {
      if (!held) return;
      held = false;
      unlockFd(fd);
      closeSync(fd);
    },
  };
};

/**
 * Waits for the repo-wide lock. Every `git fetch`, `worktree add`, `worktree prune` and eviction of a
 * repo runs under it, so concurrent `factory-cell` instances on one repo never race on `.git/*.lock`
 * and never evict a worktree another instance is preparing. The flock is per process, so it also orders
 * prepares inside one process.
 */
export const acquireRepoLock = async (repoRoot: string): Promise<Lease> => {
  const file = join(repoRoot, LOCK_DIR, 'git.lock');
  for (;;) {
    const lease = tryLock(file);
    if (lease) return lease;
    await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS));
  }
};

/** Runs `work` holding the repo lock, and releases the lock when it settles. */
export const withRepoLock = async <T>(
  repoRoot: string,
  work: () => Promise<T>,
): Promise<T> => {
  const lock = await acquireRepoLock(repoRoot);
  try {
    return await work();
  } finally {
    lock.release();
  }
};

/**
 * Takes the in-use lease of one worktree, without waiting. A worktree held by a job of another Cell
 * instance (or by this one) is busy, so this returns undefined and eviction skips it.
 */
export const tryLockWorktree = (
  repoRoot: string,
  worktreePath: string,
): Lease | undefined => {
  const key = createHash('sha256').update(worktreePath).digest('hex');
  return tryLock(join(repoRoot, LOCK_DIR, `worktree-${key.slice(0, 32)}.lock`));
};
