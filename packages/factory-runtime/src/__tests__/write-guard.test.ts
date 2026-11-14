import { describe, expect, it } from 'vitest';
import type { CellId } from '@repo/factory-core/ids';
import { PROJECT, helloCell, sha256Ref, world } from './test-kit';

const CELL = '01J0000000000000000000000W' as CellId;
const NEW_CELL = '01J0000000000000000000000X' as CellId;
const LOCK_LOST = /writer lock is not held/;

const hello = {
  version: '2.0.0',
  projects: [PROJECT],
  runners: ['claude'],
  capabilities: [],
  slots: 1,
};

describe('write guard on every write path', () => {
  it('refuses hello without the writer lock and registers nothing', async () => {
    const w = world();
    w.writer.held = false;

    await expect(
      w.runtime.call('hello', { cellId: NEW_CELL, ...hello }),
    ).rejects.toThrow(LOCK_LOST);
    expect(w.cells.all()).toEqual([]);
  });

  it('refuses heartbeat without the writer lock and touches nothing', async () => {
    const w = world();
    await helloCell(w, CELL);
    const before = w.cells.all()[0]?.lastSeenAt;
    w.clock.advance(5_000);
    w.writer.held = false;

    await expect(
      w.runtime.call('heartbeat', { cellId: CELL, jobs: [], acked: [] }),
    ).rejects.toThrow(LOCK_LOST);
    expect(w.cells.all()[0]?.lastSeenAt).toBe(before);
  });

  it('refuses a Cell revocation without the writer lock and keeps the Cell live', async () => {
    const w = world();
    await helloCell(w, CELL);
    w.writer.held = false;

    await expect(
      w.runtime.call('cellRevoke', { cellId: CELL }),
    ).rejects.toThrow(LOCK_LOST);
    expect(w.cells.all()[0]?.revokedAt).toBeNull();
  });

  it('refuses a blob put without the writer lock and stores nothing', async () => {
    const w = world();
    const ref = sha256Ref('hello');
    w.writer.held = false;

    await expect(
      w.runtime.call('blobPut', {
        ref,
        base64: Buffer.from('hello').toString('base64'),
      }),
    ).rejects.toThrow(LOCK_LOST);
    expect(await w.blobs.get(ref)).toBeUndefined();
  });

  it('refuses boot grace on start without the writer lock', async () => {
    const w = world();
    w.writer.held = false;

    await expect(w.runtime.start()).rejects.toThrow(LOCK_LOST);
  });

  it('refuses a reaper pass without the writer lock', async () => {
    const w = world();
    w.writer.held = false;

    await expect(w.runtime.reapOnce()).rejects.toThrow(LOCK_LOST);
  });
});
