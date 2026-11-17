import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { BlobRef } from '@repo/factory-core/ids';
import type { StoredEvent } from '@repo/factory-core/order/events';
import { SCENARIO_FIXTURES, fixtureEvents } from '@repo/factory-core/testing';
import { drizzleOf } from '../db';
import { blobs } from '../schema';
import {
  blobRefOf,
  hexOf,
  referencedBlobs,
  sqliteBlobStore,
} from '../sqlite-blob-store';
import { acquireWriter, type WriterLock } from '../writer-lock';
import { listBlobFiles } from '../file-blob-store';
import { appendHistory, openSeededStore, scratchBlobDir } from './helpers';

const DAY = 24 * 60 * 60 * 1000;
const dirs: string[] = [];
const locks: WriterLock[] = [];

afterEach(() => {
  for (const lock of locks) lock.release();
  locks.length = 0;
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs.length = 0;
});

const writerIn = (): WriterLock => {
  const dir = mkdtempSync(join(tmpdir(), 'factory-sweep-'));
  dirs.push(dir);
  const lock = acquireWriter(dir);
  locks.push(lock);
  return lock;
};

/** The fixture history with a completed cycle citing `ref` as its plan artifact. */
const citing = (events: StoredEvent[], ref: string): StoredEvent[] =>
  events.map((stored) => {
    const { event } = stored;
    if (event.type === 'cycle_completed') {
      return { ...stored, event: { ...event, artifacts: { plan: ref } } };
    }
    return stored;
  }) as StoredEvent[];

describe('the SQLite blob sweep', () => {
  it('never deletes a blob an event cites, even when the caller protects nothing', async () => {
    const writer = writerIn();
    const { db, store } = openSeededStore();
    const bytes = new TextEncoder().encode('plan body, cited by an event');
    const ref = blobRefOf(bytes);
    const fixture = SCENARIO_FIXTURES.find((f) =>
      citing(fixtureEvents(f), ref).some(
        (e) => e.event.type === 'cycle_completed',
      ),
    );
    expect(fixture).toBeDefined();
    await appendHistory(store, citing(fixtureEvents(fixture!), ref));

    const blobStore = sqliteBlobStore(
      db,
      writer,
      store.gate,
      scratchBlobDir(),
      {
        now: () => 0,
      },
    );
    await blobStore.put(ref, bytes, 'text/markdown');
    expect(referencedBlobs(drizzleOf(db))).toContain(ref as BlobRef);

    const removed = await blobStore.sweep(2 * DAY, new Set());

    expect(removed).toEqual([]);
    expect(await blobStore.get(ref)).toEqual(bytes);
    expect(drizzleOf(db).select().from(blobs).all()).toHaveLength(1);
  });

  it('deletes an unreferenced log file once it is a day old, and keeps a referenced one', async () => {
    const writer = writerIn();
    const { db, store } = openSeededStore();
    const blobDir = scratchBlobDir();
    const blobStore = sqliteBlobStore(db, writer, store.gate, blobDir, {
      now: () => 0,
    });
    const kept = new TextEncoder().encode('a log an event still names');
    const dropped = new TextEncoder().encode('a log nothing names');
    const keptRef = blobRefOf(kept);
    const droppedRef = blobRefOf(dropped);
    await blobStore.put(keptRef, kept, 'text/plain', 'log');
    await blobStore.put(droppedRef, dropped, 'text/plain', 'log');

    expect(await blobStore.sweep(DAY - 1, new Set())).toEqual([]);
    const removed = await blobStore.sweep(DAY, new Set([keptRef]));

    expect(removed).toEqual([droppedRef]);
    expect(listBlobFiles(blobDir)).toEqual([hexOf(keptRef)]);
    expect(await blobStore.get(keptRef)).toEqual(kept);
    expect(await blobStore.get(droppedRef)).toBeUndefined();
  });
});
