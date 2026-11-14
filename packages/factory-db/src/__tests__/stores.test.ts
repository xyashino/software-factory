import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { BlobRef, JobId, OrderId, WorkerId } from '@repo/factory-core/ids';
import { openSeededStore } from './helpers';
import { blobRefOf, sqliteBlobStore } from '../sqlite-blob-store';
import { sqliteLeaseStore } from '../sqlite-lease-store';
import { sqliteSignalStore } from '../signals-table';
import { sqliteWorkerStore } from '../workers-table';
import {
  acquireWriter,
  type WriterLock,
  WriterNotHeldError,
} from '../writer-lock';

const WORKER = '01J0000000000000000000000A' as WorkerId;
const OTHER = '01J0000000000000000000000B' as WorkerId;
const ORDER = 'software-factory/todo-a' as OrderId;
const JOB = '01J0000000000000000000000J' as JobId;
const OTHER_JOB = '01J0000000000000000000000K' as JobId;
const INFO = {
  version: '1',
  projects: ['software-factory'],
  runners: ['claude'],
  capabilities: [],
  slots: 1,
};

const locks: WriterLock[] = [];

afterEach(() => {
  for (const lock of locks) lock.release();
  locks.length = 0;
});

/** A migrated, seeded database with a held writer lock in a fresh temp directory. */
const setup = () => {
  const { db, store } = openSeededStore();
  const writer = acquireWriter(mkdtempSync(join(tmpdir(), 'factory-stores-')));
  locks.push(writer);
  return { db, store, writer };
};

describe('blob store', () => {
  it('stores bytes under their hash and reads them back', async () => {
    const { db, store, writer } = setup();
    const blobs = sqliteBlobStore(db, writer, store.gate);
    const bytes = new TextEncoder().encode('plan body');
    const ref = blobRefOf(bytes);

    await blobs.put(ref, bytes, 'text/plain');

    expect(await blobs.get(ref)).toEqual(bytes);
    expect((await blobs.stat([ref])).get(ref)).toBe(bytes.byteLength);
  });

  it('refuses bytes that do not hash to the ref it was given', async () => {
    const { db, store, writer } = setup();
    const blobs = sqliteBlobStore(db, writer, store.gate);
    const wrong = blobRefOf(new Uint8Array([1])) as BlobRef;

    await expect(blobs.put(wrong, new Uint8Array([2]))).rejects.toThrow(
      /does not hash/,
    );
  });

  it('treats a repeated put of the same ref as a no-op', async () => {
    const { db, store, writer } = setup();
    const blobs = sqliteBlobStore(db, writer, store.gate);
    const bytes = new Uint8Array([9, 9]);
    const ref = blobRefOf(bytes);

    await blobs.put(ref, bytes);
    await blobs.put(ref, bytes);

    const count = db
      .query<{ n: number }, []>('SELECT COUNT(*) AS n FROM blobs')
      .get();
    expect(count?.n).toBe(1);
  });

  it('refuses a write once the writer lock is released', async () => {
    const { db, store, writer } = setup();
    const blobs = sqliteBlobStore(db, writer, store.gate);
    writer.release();
    const bytes = new Uint8Array([1]);

    await expect(blobs.put(blobRefOf(bytes), bytes)).rejects.toThrow(
      WriterNotHeldError,
    );
  });
});

describe('lease store', () => {
  it('inserts, extends, lists and expires the leases of a worker', async () => {
    const { db, store, writer } = setup();
    const workers = sqliteWorkerStore(db, writer, store.gate);
    await workers.hello({ workerId: WORKER, name: 'w', info: INFO, at: 0 });
    const leases = sqliteLeaseStore(db, writer, store.gate);

    await leases.insert({
      orderId: ORDER,
      jobId: JOB,
      workerId: WORKER,
      epoch: 1,
      expiresAt: 100,
    });

    expect(await leases.forWorker(WORKER)).toHaveLength(1);
    expect(await leases.forWorker(OTHER)).toHaveLength(0);
    await leases.extend(WORKER, [JOB], 500);
    expect(await leases.expired(499)).toHaveLength(0);
    expect((await leases.expired(500))[0]?.orderId).toBe(ORDER);
    expect(await leases.list()).toHaveLength(1);
    await leases.delete(ORDER);
    expect(await leases.list()).toHaveLength(0);
  });

  it('refuses a lease for a Worker that has never said hello', async () => {
    const { db, store, writer } = setup();
    const leases = sqliteLeaseStore(db, writer, store.gate);

    await expect(
      leases.insert({
        orderId: ORDER,
        jobId: JOB,
        workerId: OTHER,
        epoch: 1,
        expiresAt: 100,
      }),
    ).rejects.toThrow(/FOREIGN KEY/);
  });
});

describe('signal store', () => {
  it('keeps a signal until it is acknowledged, then drops it with the job', async () => {
    const { db, store, writer } = setup();
    const signals = sqliteSignalStore(db, writer, store.gate);
    await signals.insert({
      signalId: 's1',
      jobId: JOB,
      kind: 'nudge',
      text: 'keep going',
      createdAt: 1,
    });
    await signals.insert({
      signalId: 's2',
      jobId: OTHER_JOB,
      kind: 'nudge',
      text: 'elsewhere',
      createdAt: 2,
    });

    expect((await signals.unacked(JOB)).map((s) => s.signalId)).toEqual(['s1']);
    await signals.ack(['s1'], 3);
    expect(await signals.unacked(JOB)).toEqual([]);
    await signals.deleteForJob(OTHER_JOB);
    expect(await signals.unacked(OTHER_JOB)).toEqual([]);
  });
});

describe('worker store', () => {
  it('registers a worker once, revokes it, and keeps the first revocation', async () => {
    const { db, store, writer } = setup();
    const workers = sqliteWorkerStore(db, writer, store.gate);
    await workers.hello({
      workerId: WORKER,
      name: 'laptop',
      info: INFO,
      at: 5,
    });
    await workers.revoke(WORKER, 9);
    await workers.revoke(WORKER, 12);

    const record = await workers.get(WORKER);

    expect(record?.revokedAt).toBe(9);
    expect(record?.info?.runners).toEqual(['claude']);
    expect(await workers.list()).toHaveLength(1);
  });
});
