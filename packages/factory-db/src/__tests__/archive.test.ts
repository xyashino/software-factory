import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Database } from 'bun:sqlite';
import type { BlobRef } from '@repo/factory-core/ids';
import type { StoredEvent } from '@repo/factory-core/order/events';
import { SCENARIO_FIXTURES, fixtureEvents } from '@repo/factory-core/testing';
import { sqliteArchive } from '../archive';
import { sqliteBlobStore, blobRefOf } from '../sqlite-blob-store';
import { openDatabase, openSqliteEventStore } from '../sqlite-event-store';
import { acquireWriter, type WriterLock } from '../writer-lock';
import {
  appendHistory,
  openMigratedDatabase,
  openSeededStore,
  projectRow,
  rawOrders,
} from './helpers';

const locks: WriterLock[] = [];
const workDir = (): string => mkdtempSync(join(tmpdir(), 'factory-archive-'));

afterEach(() => {
  for (const lock of locks) lock.release();
  locks.length = 0;
});

const lockedIn = (dir: string): WriterLock => {
  const lock = acquireWriter(dir);
  locks.push(lock);
  return lock;
};

/** Every row of a table as SQLite stores it, for byte-for-byte comparison. */
const rawRows = (db: Database, table: string): string =>
  JSON.stringify(db.query(`SELECT * FROM ${table} ORDER BY 1`).all());

const SHA256_REF = /sha256:[0-9a-f]{64}/g;

const citedRefsOf = (events: readonly StoredEvent[]): string[] => [
  ...new Set(JSON.stringify(events).match(SHA256_REF) ?? []),
];

const storeCitedBlobs = async (
  source: ReturnType<typeof openSeededStore>,
  writer: WriterLock,
  events: readonly StoredEvent[],
) => {
  const blobStore = sqliteBlobStore(source.db, writer, source.store.gate);
  const refs = new Map<string, BlobRef>();
  for (const placeholder of citedRefsOf(events)) {
    const bytes = new TextEncoder().encode(`blob:${placeholder}`);
    const ref = blobRefOf(bytes);
    await blobStore.put(ref, bytes, 'text/plain');
    refs.set(placeholder, ref);
  }
  let text = JSON.stringify(events);
  for (const [placeholder, ref] of refs) {
    text = text.replaceAll(placeholder, ref);
  }
  return JSON.parse(text) as StoredEvent[];
};

describe('export and import', () => {
  it.each(SCENARIO_FIXTURES.map((fixture) => [fixture.name, fixture] as const))(
    'reproduces the events, cited blobs and orders of %s in an empty database',
    async (_name, fixture) => {
      const source = openSeededStore();
      const sourceWriter = lockedIn(workDir());
      const events = await storeCitedBlobs(
        source,
        sourceWriter,
        fixtureEvents(fixture),
      );
      await appendHistory(source.store, events);
      const file = join(workDir(), 'export.tar');
      const sourceArchive = sqliteArchive(
        source.db,
        source.store,
        sourceWriter,
      );
      await sourceArchive.exportTo(file, 1_700_000_000_000);

      const target = openMigratedDatabase();
      const targetStore = openSqliteEventStore(target);
      const targetArchive = sqliteArchive(
        target,
        targetStore,
        lockedIn(workDir()),
      );
      const counts = await targetArchive.importFrom(file, projectRow, 99);

      expect(counts.events).toBe(events.length);
      expect(rawRows(target, 'events')).toBe(rawRows(source.db, 'events'));
      expect(rawRows(target, 'projects')).toBe(rawRows(source.db, 'projects'));
      expect(rawOrders(target)).toBe(rawOrders(source.db));
    },
  );

  it('reports the global position it exported', async () => {
    const source = openSeededStore();
    const writer = lockedIn(workDir());
    const events = await storeCitedBlobs(
      source,
      writer,
      fixtureEvents(SCENARIO_FIXTURES[0]!),
    );
    await appendHistory(source.store, events);
    const archive = sqliteArchive(source.db, source.store, writer);

    const counts = await archive.exportTo(join(workDir(), 'export.tar'), 1);

    expect(counts.globalSeq).toBe(events.length);
  });

  it('refuses to import into a database that already holds a project', async () => {
    const source = openSeededStore();
    const writer = lockedIn(workDir());
    const events = await storeCitedBlobs(
      source,
      writer,
      fixtureEvents(SCENARIO_FIXTURES[0]!),
    );
    await appendHistory(source.store, events);
    const file = join(workDir(), 'export.tar');
    await sqliteArchive(source.db, source.store, writer).exportTo(file, 1);
    const busy = openSeededStore();
    const busyArchive = sqliteArchive(busy.db, busy.store, lockedIn(workDir()));

    await expect(busyArchive.importFrom(file, projectRow, 2)).rejects.toThrow(
      /needs an empty database/,
    );
  });

  it('refuses to overwrite an existing export file', async () => {
    const source = openSeededStore();
    const file = join(workDir(), 'export.tar');
    const archive = sqliteArchive(source.db, source.store, lockedIn(workDir()));
    await archive.exportTo(file, 1);

    await expect(archive.exportTo(file, 2)).rejects.toThrow(
      /refusing to overwrite/,
    );
  });
});

describe('backup', () => {
  it('writes a database file that opens with the same events', async () => {
    const source = openSeededStore();
    await appendHistory(source.store, fixtureEvents(SCENARIO_FIXTURES[0]!));
    const file = join(workDir(), 'backup.db');
    const archive = sqliteArchive(source.db, source.store, lockedIn(workDir()));

    const counts = await archive.backup(file);
    const copy = openDatabase(file);
    try {
      expect(rawRows(copy, 'events')).toBe(rawRows(source.db, 'events'));
      expect(counts.events).toBe(fixtureEvents(SCENARIO_FIXTURES[0]!).length);
    } finally {
      copy.close();
    }
  });
});
