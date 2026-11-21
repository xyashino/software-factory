import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createPidFile } from '../../../../src/adapters/fs/pid-file';

const FIRST_HOLDER = 111;
const SECOND_HOLDER = 222;
const GONE_HOLDER = 333;
const NEWCOMER = 444;

const freshDir = (): string => mkdtempSync(join(tmpdir(), 'factory-pid-'));

const onlyAlive =
  (alive: readonly number[]) =>
  (pid: number): boolean =>
    alive.includes(pid);

describe('pid file lock', () => {
  it('claims a slot nobody holds', async () => {
    // Arrange
    const pidFile = createPidFile('dev-box.pid', onlyAlive([]));

    // Act
    const claimed = await pidFile.acquire(freshDir(), FIRST_HOLDER);

    // Assert
    expect(claimed).toBe(true);
  });

  it('refuses a slot held by a live process', async () => {
    // Arrange
    const dir = freshDir();
    const pidFile = createPidFile('dev-box.pid', onlyAlive([FIRST_HOLDER]));
    await pidFile.acquire(dir, FIRST_HOLDER);

    // Act
    const claimed = await pidFile.acquire(dir, SECOND_HOLDER);

    // Assert
    expect(claimed).toBe(false);
    expect(await pidFile.read(dir)).toBe(FIRST_HOLDER);
  });

  it('takes over a slot whose holder is gone', async () => {
    // Arrange
    const dir = freshDir();
    const pidFile = createPidFile('dev-box.pid', onlyAlive([]));
    await pidFile.write(dir, GONE_HOLDER);

    // Act
    const claimed = await pidFile.acquire(dir, NEWCOMER);

    // Assert
    expect(claimed).toBe(true);
    expect(await pidFile.read(dir)).toBe(NEWCOMER);
  });

  it('frees the slot again once released', async () => {
    // Arrange
    const dir = freshDir();
    const pidFile = createPidFile('dev-box.pid', onlyAlive([FIRST_HOLDER]));
    await pidFile.acquire(dir, FIRST_HOLDER);
    await pidFile.remove(dir);

    // Act
    const claimed = await pidFile.acquire(dir, SECOND_HOLDER);

    // Assert
    expect(claimed).toBe(true);
  });

  it('keeps separate slots for separate cell names', async () => {
    // Arrange
    const dir = freshDir();
    const host = createPidFile('host.pid', onlyAlive([FIRST_HOLDER]));
    const second = createPidFile('host-2.pid', onlyAlive([FIRST_HOLDER]));
    await host.acquire(dir, FIRST_HOLDER);

    // Act
    const claimed = await second.acquire(dir, SECOND_HOLDER);

    // Assert
    expect(claimed).toBe(true);
  });
});
