import { closeSync, mkdirSync, openSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tryLockExclusive, unlockFd } from './flock';

/** The lock file inside a Cell's instance data directory. Its presence is harmless; the flock is the lock. */
export const CELL_LOCK_FILE_NAME = 'cell.lock';

const MAX_INSTANCES = 1024;

export interface InstanceClaim {
  readonly cellDataDir: string;
  readonly instance: number;
  /** Releases the instance lock and closes the file descriptor. Idempotent. */
  release(): void;
}

const tryAcquire = (dir: string): (() => void) | undefined => {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const lockPath = join(dir, CELL_LOCK_FILE_NAME);
  const fd = openSync(lockPath, 'a+', 0o600);
  if (!tryLockExclusive(fd)) {
    closeSync(fd);
    return undefined;
  }
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    unlockFd(fd);
    closeSync(fd);
  };
};

/**
 * Claims an exclusive data directory for this Cell process.
 *
 * The first running process takes `baseDir` (`instance: 1`) so single-Cell setups keep using the
 * configured directory and identity. Each additional concurrent process launched with the same
 * `baseDir` automatically claims `${baseDir}-2`, `${baseDir}-3`,... so it gets its own identity
 * (`credential`), logs and cycle files instead of colliding with the running Cell.
 */
export const claimInstanceDir = (baseDir: string): InstanceClaim => {
  const normalized = resolve(baseDir);
  const firstRelease = tryAcquire(normalized);
  if (firstRelease) {
    return {
      cellDataDir: normalized,
      instance: 1,
      release: firstRelease,
    };
  }
  for (let instance = 2; instance <= MAX_INSTANCES; instance += 1) {
    const candidate = `${normalized}-${instance}`;
    const release = tryAcquire(candidate);
    if (release) {
      return {
        cellDataDir: candidate,
        instance,
        release,
      };
    }
  }
  throw new Error(
    `unable to claim a cell instance directory under ${normalized} (checked ${MAX_INSTANCES} instance directories)`,
  );
};
