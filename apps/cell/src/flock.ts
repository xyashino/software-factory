import { dlopen, FFIType } from 'bun:ffi';

const LOCK_EX = 2;
const LOCK_NB = 4;
const LOCK_UN = 8;

type Flock = (fd: number, operation: number) => number;

let flockCache: Flock | undefined;

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
 * Takes an exclusive flock on an open file descriptor without waiting. Locks are per open file
 * description, so two descriptors in one process conflict too. Returns false when another holder has it.
 */
export const tryLockExclusive = (fd: number): boolean =>
  flock()(fd, LOCK_EX | LOCK_NB) === 0;

/** Releases a flock taken with `tryLockExclusive`. The descriptor stays open until the caller closes it. */
export const unlockFd = (fd: number): void => {
  flock()(fd, LOCK_UN);
};
