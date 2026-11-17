import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { OrderId } from '@repo/factory-core/ids';
import { MIGRATIONS_DIR, migrate } from '../migrate';
import { sqliteProjectStore, sqliteProjectionReader } from '../projects-table';
import { projects } from '../schema';
import { blobRefOf, sqliteBlobStore } from '../sqlite-blob-store';
import {
  openDatabase,
  openReadDatabase,
  openSqliteEventStore,
} from '../sqlite-event-store';
import { acquireWriter, type WriterLock } from '../writer-lock';
import { openSeededStore, scratchBlobDir, seedProject } from './helpers';

const ORDER = 'software-factory:todo-a' as OrderId;
const LATER = 'later-project';

const locks: WriterLock[] = [];
const dirs: string[] = [];

afterEach(() => {
  for (const lock of locks) lock.release();
  locks.length = 0;
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs.length = 0;
});

/** A promise the test resolves by hand: the body of an open write transaction waits on it. */
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

/** The value, or a rejection when the read is not served within `ms`: the signature of a read queued behind a write. */
const within = <T>(promise: Promise<T>, ms = 300): Promise<T> =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`not served within ${ms} ms`)), ms),
    ),
  ]);

/** A migrated, seeded file database with its read-only connection and a held writer lock. */
const openFileStore = () => {
  const dir = mkdtempSync(join(tmpdir(), 'factory-read-path-'));
  dirs.push(dir);
  const file = join(dir, 'factory.db');
  const db = openDatabase(file);
  migrate(db, MIGRATIONS_DIR);
  seedProject(db);
  const readDb = openReadDatabase(file);
  const store = openSqliteEventStore(db, readDb);
  const writer = acquireWriter(dir);
  locks.push(writer);
  return { db, readDb, store, writer };
};

/** Inserts a project row on the writer connection, inside whatever transaction is open. */
const insertLater = (db: ReturnType<typeof openDatabase>): void => {
  db.run(
    'INSERT INTO projects (project_id, repo_url, created_at) VALUES (?, ?, ?)',
    [LATER, 'https://example.test/later.git', 0],
  );
};

describe('reads outside a transaction, file database (WAL)', () => {
  it('are served while a write transaction is open, and see only committed rows', async () => {
    const { db, store, writer } = openFileStore();
    const registry = sqliteProjectStore(db, writer, store.gate);
    const held = deferred();
    const writing = store.transaction(async () => {
      insertLater(db);
      await held.promise;
    });

    // The transaction is still open: a read queued behind it would not resolve in time.
    const seen = await within(registry.list());
    expect(seen.map((row) => row.projectId)).toEqual(['software-factory']);

    held.resolve();
    await writing;
    const after = await registry.list();
    expect(after.map((row) => row.projectId)).toEqual([
      LATER,
      'software-factory',
    ]);
  });

  it('serves the projections, the event reads and the blob store while a transaction is open', async () => {
    const { db, store, writer } = openFileStore();
    const blobs = sqliteBlobStore(db, writer, store.gate, scratchBlobDir());
    const bytes = new TextEncoder().encode('plan body');
    const ref = blobRefOf(bytes);
    await blobs.put(ref, bytes);
    const reader = sqliteProjectionReader(store.gate);

    const held = deferred();
    const writing = store.transaction(async () => {
      insertLater(db);
      await held.promise;
    });

    expect(await within(reader.orders())).toEqual([]);
    expect(await within(reader.plans())).toEqual([]);
    expect(await within(blobs.get(ref))).toEqual(bytes);
    expect(await within(blobs.stat([ref]))).toEqual(
      new Map([[ref, bytes.byteLength]]),
    );
    expect(await within(store.load(ORDER))).toEqual([]);
    expect(await within(store.feed(0, 10))).toEqual([]);

    held.resolve();
    await writing;
  });

  it('cannot write: the read connection is read-only', () => {
    const { readDb } = openFileStore();
    expect(() =>
      readDb.run(
        'INSERT INTO projects (project_id, repo_url, created_at) VALUES (?, ?, ?)',
        ['nope', 'https://example.test/nope.git', 0],
      ),
    ).toThrow();
  });
});

describe('reads inside a transaction', () => {
  it('see the transaction’s own uncommitted write', async () => {
    const { db, store } = openFileStore();
    const counted = await store.transaction(async () => {
      insertLater(db);
      return store.gate.read(
        (reader) => reader.select().from(projects).all().length,
      );
    });
    expect(counted).toBe(2);
  });
});

describe('reads on the in-memory fallback (no read connection)', () => {
  it('queue behind an open write transaction, as they did before the read connection', async () => {
    const { db, store } = openSeededStore();
    const held = deferred();
    const writing = store.transaction(async () => {
      insertLater(db);
      await held.promise;
    });
    await expect(within(store.load(ORDER), 100)).rejects.toThrow(
      'not served within 100 ms',
    );
    held.resolve();
    await writing;
    expect(await store.load(ORDER)).toEqual([]);
  });
});
