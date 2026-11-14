import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { BlobRef } from '@repo/factory-core/ids';
import type { StoredEvent } from '@repo/factory-core/order/events';
import type { EventStore } from '@repo/factory-core/ports/event-store';
import {
  SCENARIO_FIXTURES,
  type ScenarioFixture,
  fixtureEvents,
} from '@repo/factory-core/testing';
import {
  EXPORT_FORMAT,
  EXPORT_VERSION,
  exportFactory,
  importFactory,
} from '../export-import';
import {
  appendHistory,
  openMigratedDatabase,
  openSeededStore,
  projectRow,
  rawOrders,
} from './helpers';
import { drizzleOf } from '../db';
import { blobs, projects } from '../schema';
import { blobRefOf, sqliteBlobStore } from '../sqlite-blob-store';
import { openSqliteEventStore } from '../sqlite-event-store';
import { readTar, writeTar } from '../tar';
import { acquireWriter, type WriterLock } from '../writer-lock';

const dirs: string[] = [];
const locks: WriterLock[] = [];

afterEach(() => {
  for (const lock of locks) lock.release();
  locks.length = 0;
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs.length = 0;
});

const writerIn = (): WriterLock => {
  const dir = mkdtempSync(join(tmpdir(), 'factory-export-'));
  dirs.push(dir);
  const lock = acquireWriter(dir);
  locks.push(lock);
  return lock;
};

type EventFeed = Pick<EventStore, 'feed'>;

/** Every stored event, in global order. */
const everyEvent = (store: EventFeed): Promise<StoredEvent[]> =>
  store.feed(0, 1_000_000);

const SHA256_REF = /sha256:[0-9a-f]{64}/g;

/** Every distinct blob ref the events cite, as written in their JSON. */
const citedRefsOf = (events: readonly StoredEvent[]): string[] => [
  ...new Set(JSON.stringify(events).match(SHA256_REF) ?? []),
];

/** The events with every cited ref replaced by `toRef(ref)`. */
const renamed = (
  events: readonly StoredEvent[],
  toRef: (ref: string) => string,
): StoredEvent[] => {
  let text = JSON.stringify(events);
  for (const ref of citedRefsOf(events)) {
    text = text.replaceAll(ref, toRef(ref));
  }
  return JSON.parse(text) as StoredEvent[];
};

/**
 * A source Factory holding one fixture's history. Every blob the history cites is stored for real: each
 * placeholder ref in the fixture is renamed to the hash of its stored bytes, so the export finds every
 * cited blob (STORAGE §7.3).
 */
const seededWith = async (fixture: ScenarioFixture) => {
  const writer = writerIn();
  const source = openSeededStore();
  const blobStore = sqliteBlobStore(source.db, writer, source.store.gate);
  const refs = new Map<string, BlobRef>();
  const contents = new Map<BlobRef, Uint8Array>();
  for (const placeholder of citedRefsOf(fixtureEvents(fixture))) {
    const bytes = new TextEncoder().encode(
      `${placeholder}\n${'x'.repeat(8192)}`,
    );
    const ref = blobRefOf(bytes);
    await blobStore.put(ref, bytes, 'text/plain');
    refs.set(placeholder, ref);
    contents.set(ref, bytes);
  }
  const events = renamed(fixtureEvents(fixture), (ref) => refs.get(ref) ?? ref);
  await appendHistory(source.store, events);
  return { writer, source, events, contents };
};

describe('export and import', () => {
  it.each(SCENARIO_FIXTURES.map((fixture) => [fixture.name, fixture] as const))(
    'round-trips %s: identical events, blobs and rebuilt orders',
    async (_name, fixture) => {
      const { writer, source, events, contents } = await seededWith(fixture);
      const exported = await exportFactory(source.store, 42);

      const target = openMigratedDatabase();
      const targetStore = openSqliteEventStore(target);
      const result = await importFactory(targetStore, exported, projectRow, 99);

      expect(await everyEvent(targetStore)).toEqual(
        await everyEvent(source.store),
      );
      expect(rawOrders(target)).toBe(rawOrders(source.db));
      const imported = sqliteBlobStore(target, writer, targetStore.gate);
      for (const [ref, bytes] of contents) {
        expect(await imported.get(ref)).toEqual(bytes);
      }
      expect(result.events).toBe(events.length);
      expect(result.blobs).toBe(contents.size);
      expect(result.projects).toBe(1);
    },
  );

  it('keeps the global_seq of every imported event', async () => {
    const { source } = await seededWith(SCENARIO_FIXTURES[0]!);
    const exported = await exportFactory(source.store, 1);

    const target = openSqliteEventStore(openMigratedDatabase());
    await importFactory(target, exported, projectRow, 2);

    const seqs = (await everyEvent(target)).map((stored) => stored.globalSeq);
    expect(seqs).toEqual(
      (await everyEvent(source.store)).map((s) => s.globalSeq),
    );
  });

  it('refuses to import into a database that already has events', async () => {
    const { source } = await seededWith(SCENARIO_FIXTURES[0]!);
    const exported = await exportFactory(source.store, 1);

    await expect(
      importFactory(source.store, exported, projectRow, 2),
    ).rejects.toThrow(/empty database/);
  });

  it('leaves the target empty when the archive is refused', async () => {
    const { source } = await seededWith(SCENARIO_FIXTURES[0]!);
    const exported = await exportFactory(source.store, 1);
    const corrupt = exported.slice(0, exported.byteLength - 2048);

    const target = openMigratedDatabase();
    const targetStore = openSqliteEventStore(target);
    await expect(
      importFactory(targetStore, corrupt, projectRow, 2),
    ).rejects.toThrow(/truncated/);

    expect(drizzleOf(target).select().from(projects).all()).toEqual([]);
    expect(await everyEvent(targetStore)).toEqual([]);
  });

  it('refuses to export when an event cites a blob that is not stored', async () => {
    const source = openSeededStore();
    const missing = blobRefOf(new TextEncoder().encode('never stored'));
    const events = renamed(fixtureEvents(SCENARIO_FIXTURES[0]!), () => missing);
    expect(citedRefsOf(events).length).toBeGreaterThan(0);
    await appendHistory(source.store, events);

    await expect(exportFactory(source.store, 1)).rejects.toThrow(
      /cites blob .* not stored/,
    );
  });

  it('refuses a blob whose bytes do not hash to its name', async () => {
    const wrongName = `blobs/${'0'.repeat(64)}`;
    const archive = writeTar([
      {
        name: 'manifest.json',
        bytes: new TextEncoder().encode(
          JSON.stringify({
            format: EXPORT_FORMAT,
            version: EXPORT_VERSION,
            exportedAt: 1,
            globalSeq: 0,
            schemaVersion: 2,
          }),
        ),
      },
      { name: 'projects.jsonl', bytes: new Uint8Array() },
      { name: 'events.jsonl', bytes: new Uint8Array() },
      { name: wrongName, bytes: new TextEncoder().encode('bytes') },
    ]);
    const db = openMigratedDatabase();
    const target = openSqliteEventStore(db);

    await expect(importFactory(target, archive, projectRow, 2)).rejects.toThrow(
      /does not hash/,
    );
    expect(drizzleOf(db).select().from(blobs).all()).toEqual([]);
  });

  it('refuses an unknown export version', async () => {
    const archive = writeTar([
      {
        name: 'manifest.json',
        bytes: new TextEncoder().encode(
          JSON.stringify({
            format: EXPORT_FORMAT,
            version: 2,
            exportedAt: 1,
            globalSeq: 0,
            schemaVersion: 2,
          }),
        ),
      },
      { name: 'projects.jsonl', bytes: new Uint8Array() },
      { name: 'events.jsonl', bytes: new Uint8Array() },
    ]);
    const target = openSqliteEventStore(openMigratedDatabase());

    await expect(importFactory(target, archive, projectRow, 2)).rejects.toThrow(
      /unsupported export version 2/,
    );
  });

  it('refuses an entry outside the export layout', async () => {
    const archive = writeTar([
      { name: '../escape.json', bytes: new TextEncoder().encode('{}') },
    ]);
    const target = openSqliteEventStore(openMigratedDatabase());

    await expect(importFactory(target, archive, projectRow, 2)).rejects.toThrow(
      /unexpected export entry/,
    );
  });

  it('refuses a manifest whose globalSeq disagrees with the events', async () => {
    const { source } = await seededWith(SCENARIO_FIXTURES[0]!);
    const exported = await exportFactory(source.store, 1);
    const tampered = writeTar(
      readTar(exported).map((entry) =>
        entry.name === 'manifest.json'
          ? {
              name: entry.name,
              bytes: new TextEncoder().encode(
                JSON.stringify({
                  format: EXPORT_FORMAT,
                  version: EXPORT_VERSION,
                  exportedAt: 1,
                  globalSeq: 999,
                  schemaVersion: 2,
                }),
              ),
            }
          : entry,
      ),
    );
    const target = openSqliteEventStore(openMigratedDatabase());

    await expect(
      importFactory(target, tampered, projectRow, 2),
    ).rejects.toThrow(/does not match the last event/);
  });
});
