import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { dirname } from 'node:path';
import type { Result } from '../definitions/types';
import { supervisorLockPath } from '../paths';

/** A lock file this young with unreadable content may still be mid-write. */
const MALFORMED_GRACE_MS = 5_000;

export type LockHolder = { pid: number; startedAt: string };
export type LockHeld = { holder: LockHolder | null; path: string };
export type SupervisorLock = { release(): void };

export type LockDeps = {
  pid: number;
  now: () => Date;
  isAlive: (pid: number) => boolean;
};

export const realLockDeps: LockDeps = {
  pid: process.pid,
  now: () => new Date(),
  isAlive: (pid) => processIsAlive(pid),
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};

const parseHolder = (text: string): LockHolder | null => {
  try {
    const data: unknown = JSON.parse(text);
    if (
      isRecord(data) &&
      typeof data.pid === 'number' &&
      Number.isInteger(data.pid) &&
      data.pid > 0 &&
      typeof data.startedAt === 'string'
    ) {
      return { pid: data.pid, startedAt: data.startedAt };
    }
    return null;
  } catch {
    return null;
  }
};

const readHolder = (path: string): LockHolder | null | 'gone' => {
  try {
    return parseHolder(readFileSync(path, 'utf8'));
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') return 'gone';
    throw error;
  }
};

const readHolderOrNull = (path: string): LockHolder | null => {
  const holder = readHolder(path);
  return holder === 'gone' ? null : holder;
};

const tryCreate = (path: string, deps: LockDeps): SupervisorLock | null => {
  let fd: number;
  try {
    fd = openSync(path, 'wx');
  } catch (error) {
    if (isRecord(error) && error.code === 'EEXIST') return null;
    throw error;
  }
  try {
    const holder: LockHolder = {
      pid: deps.pid,
      startedAt: deps.now().toISOString(),
    };
    writeSync(fd, JSON.stringify(holder));
  } finally {
    closeSync(fd);
  }
  return {
    release() {
      const current = readHolder(path);
      if (current === 'gone' || current?.pid !== deps.pid) return;
      try {
        unlinkSync(path);
      } catch {
        // already removed
      }
    },
  };
};

const isStale = (
  path: string,
  holder: LockHolder | null,
  deps: LockDeps,
): boolean => {
  if (holder) return !deps.isAlive(holder.pid);
  try {
    const age = deps.now().getTime() - statSync(path).mtimeMs;
    return age > MALFORMED_GRACE_MS;
  } catch {
    return true;
  }
};

/** True when a process with this pid exists (EPERM means it does, not ours). */
export const processIsAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'EPERM';
  }
};

/**
 * Take the exclusive `.factory/supervisor.lock`. A lock whose pid no longer
 * exists is stale and taken over; a live holder is reported back.
 */
export const acquireSupervisorLock = (
  root: string,
  deps: LockDeps = realLockDeps,
): Result<SupervisorLock, LockHeld> => {
  const path = supervisorLockPath(root);
  mkdirSync(dirname(path), { recursive: true });
  for (let attempt = 0; attempt < 3; attempt++) {
    const lock = tryCreate(path, deps);
    if (lock) return { ok: true, value: lock };
    const holder = readHolder(path);
    if (holder === 'gone') continue;
    if (!isStale(path, holder, deps)) {
      return { ok: false, error: { holder, path } };
    }
    try {
      unlinkSync(path);
    } catch {
      // another starter removed it first; retry the create
    }
  }
  return { ok: false, error: { holder: readHolderOrNull(path), path } };
};
