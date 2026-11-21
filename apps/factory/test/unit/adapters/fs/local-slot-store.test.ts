import {
  existsSync,
  mkdtempSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createLocalSlotStore } from '../../../../src/adapters/fs/local-slot-store';
import { Refused } from '../../../../src/application/core/errors';
import type { LocalSlot } from '../../../../src/domain/cell/local-slot';

const SLOT: LocalSlot = {
  slotId: 'slot-1',
  name: 'dev-box',
  factory: 'http://127.0.0.1:7070',
  repoRoot: '/repo',
  pid: 4242,
  state: 'running',
  createdAt: 1_000,
};

const tempDir = (): string => mkdtempSync(join(tmpdir(), 'sf-local-slots-'));

describe('local slot store', () => {
  it('returns an empty list before any slot is saved', async () => {
    // Arrange
    const store = createLocalSlotStore(tempDir());

    // Act
    const slots = await store.read();

    // Assert
    expect(slots).toEqual([]);
  });

  it('keeps a saved slot across reads', async () => {
    // Arrange
    const store = createLocalSlotStore(tempDir());

    // Act
    await store.write([SLOT]);
    const slots = await store.read();

    // Assert
    expect(slots).toEqual([SLOT]);
  });

  it('writes the slots file readable only by its owner', async () => {
    // Arrange
    const dir = tempDir();
    const store = createLocalSlotStore(dir);

    // Act
    await store.write([SLOT]);

    // Assert
    expect(statSync(join(dir, 'slots.json')).mode & 0o777).toBe(0o600);
  });

  it('leaves no staging file behind after a write', async () => {
    // Arrange
    const dir = tempDir();
    const store = createLocalSlotStore(dir);

    // Act
    await store.write([SLOT]);

    // Assert
    expect(readdirSync(dir).some((name) => name.includes('.tmp-'))).toBe(false);
  });

  it('refuses a slots file that is not JSON', async () => {
    // Arrange
    const dir = tempDir();
    writeFileSync(join(dir, 'slots.json'), '{not json');
    const store = createLocalSlotStore(dir);

    // Act
    const read = store.read();

    // Assert
    await expect(read).rejects.toBeInstanceOf(Refused);
  });

  it('refuses a slots file with the wrong shape', async () => {
    // Arrange
    const dir = tempDir();
    writeFileSync(join(dir, 'slots.json'), JSON.stringify([{ slotId: 'x' }]));
    const store = createLocalSlotStore(dir);

    // Act
    const read = store.read();

    // Assert
    await expect(read).rejects.toBeInstanceOf(Refused);
  });

  it('removes a slot together with its pid and log files', async () => {
    // Arrange
    const dir = tempDir();
    const store = createLocalSlotStore(dir);
    await store.write([SLOT]);
    writeFileSync(store.logPathOf(SLOT.slotId), 'log line\n');

    // Act
    await store.remove(SLOT.slotId);

    // Assert
    expect(await store.read()).toEqual([]);
    expect(existsSync(store.logPathOf(SLOT.slotId))).toBe(false);
    expect(existsSync(join(dir, `${SLOT.slotId}.pid`))).toBe(false);
  });
});
