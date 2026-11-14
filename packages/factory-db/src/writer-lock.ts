import { dlopen, FFIType } from 'bun:ffi';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import { join } from 'node:path';

/** The lock file in the data directory (STORAGE §1). Its presence is harmless; the flock is the lock. */
export const LOCK_FILE_NAME = 'factory.lock';

/** Another process holds the writer lock of this data directory. Refused at once, never waited for. */
export class WriterHeldError extends Error {
  readonly lockFile: string;

  constructor(lockFile: string) {
    super(`another factory-server holds ${lockFile}`);
    this.name = 'WriterHeldError';
    this.lockFile = lockFile;
  }
}

/** A write was attempted without the writer lock, or after it was released. */
export class WriterNotHeldError extends Error {
  constructor() {
    super('the writer lock is not held; this process may not write');
    this.name = 'WriterNotHeldError';
  }
}

/** The writer lock: the only proof that this process may write to the database. */
export interface WriterLock {
  readonly path: string;
  readonly held: boolean;
  /** Throws WriterNotHeldError unless the lock is held. Every write path calls it. */
  assertHeld(): void;
  /** Releases the lock and closes the file. Idempotent. */
  release(): void;
}

const LOCK_EX = 2;
const LOCK_NB = 4;
const LOCK_UN = 8;

type Flock = (fd: number, operation: number) => number;

let flockCache: Flock | undefined;

/** libc `flock` through bun:ffi (Linux and macOS, STORAGE §1). Loaded once per process. */
const flock = (): Flock => {
  if (!flockCache) {
    const library =
      process.platform === 'darwin' ? 'libSystem.B.dylib' : 'libc.so.6';
    const { symbols } = dlopen(library, {
      flock: {
        args: [FFIType.i32, FFIType.i32],
        returns: FFIType.i32,
      },
    });
    flockCache = (fd, operation) => symbols.flock(fd, operation);
  }
  return flockCache;
};

/**
 * Takes an exclusive, non-blocking `flock` on `<dataDir>/factory.lock`. A second process gets
 * `WriterHeldError` at once. The kernel releases the lock when the holder exits or crashes, so no
 * pid file and no staleness check are needed. The data directory is created with mode 0700.
 */
export const acquireWriter = (dataDir: string): WriterLock => {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const path = join(dataDir, LOCK_FILE_NAME);
  const fd = openSync(path, 'a+', 0o600);
  if (flock()(fd, LOCK_EX | LOCK_NB) !== 0) {
    closeSync(fd);
    throw new WriterHeldError(path);
  }
  let held = true;
  return {
    path,
    get held() {
      return held;
    },
    assertHeld: () => {
      if (!held) throw new WriterNotHeldError();
    },
    release: () => {
      if (!held) return;
      held = false;
      flock()(fd, LOCK_UN);
      closeSync(fd);
    },
  };
};
