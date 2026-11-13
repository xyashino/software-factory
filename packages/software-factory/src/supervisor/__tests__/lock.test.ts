import { existsSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { supervisorLockPath } from '../../paths';
import { acquireSupervisorLock, type LockDeps } from '../lock';

const NOW = new Date('2026-11-12T10:00:00.000Z');

const scratch = (): string => {
  return mkdtempSync(join(tmpdir(), 'sf-lock-'));
};

const deps = (pid: number, alive: number[] = []): LockDeps => {
  return { pid, now: () => NOW, isAlive: (p) => alive.includes(p) };
};

describe('supervisor lock', () => {
  it('is acquired on a fresh root and records pid and start time', () => {
    const root = scratch();

    const result = acquireSupervisorLock(root, deps(100));

    expect(result.ok).toBe(true);
    expect(existsSync(supervisorLockPath(root))).toBe(true);
  });

  it('refuses a second acquire while the first holder is alive', () => {
    const root = scratch();
    acquireSupervisorLock(root, deps(100));

    const second = acquireSupervisorLock(root, deps(200, [100]));

    expect(second).toEqual({
      ok: false,
      error: {
        holder: { pid: 100, startedAt: NOW.toISOString() },
        path: supervisorLockPath(root),
      },
    });
  });

  it('takes over a lock left by a dead pid', () => {
    const root = scratch();
    acquireSupervisorLock(root, deps(100));

    const second = acquireSupervisorLock(root, deps(200, []));

    expect(second.ok).toBe(true);
  });

  it('lets the next acquire succeed after release', () => {
    const root = scratch();
    const first = acquireSupervisorLock(root, deps(100));
    if (!first.ok) throw new Error('first acquire failed');

    first.value.release();

    expect(existsSync(supervisorLockPath(root))).toBe(false);
    expect(acquireSupervisorLock(root, deps(200, [100])).ok).toBe(true);
  });

  it('does not delete a lock now owned by another pid on release', () => {
    const root = scratch();
    const first = acquireSupervisorLock(root, deps(100));
    if (!first.ok) throw new Error('first acquire failed');
    acquireSupervisorLock(root, deps(200, []));

    first.value.release();

    expect(existsSync(supervisorLockPath(root))).toBe(true);
    expect(acquireSupervisorLock(root, deps(300, [200])).ok).toBe(false);
  });

  it('treats a recent malformed lock file as held', () => {
    const root = scratch();
    acquireSupervisorLock(root, deps(100));
    writeFileSync(supervisorLockPath(root), 'not json');
    const justNow = { ...deps(200), now: () => new Date() };

    const result = acquireSupervisorLock(root, justNow);

    expect(result.ok).toBe(false);
  });

  it('treats an old malformed lock file as stale', () => {
    const root = scratch();
    acquireSupervisorLock(root, deps(100));
    const path = supervisorLockPath(root);
    writeFileSync(path, '');
    const old = new Date(Date.now() - 60_000);
    utimesSync(path, old, old);

    const result = acquireSupervisorLock(root, {
      ...deps(200),
      now: () => new Date(),
    });

    expect(result.ok).toBe(true);
  });
});
