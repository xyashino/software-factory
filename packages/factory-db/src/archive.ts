import type { Database } from 'bun:sqlite';
import { count, sql } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import type {
  ArchiveCounts,
  ArchivePort,
} from '@repo/factory-core/ports/archive';
import { type FactoryDatabase, drizzleOf } from './db';
import { exportFactory, importFactory } from './export-import';
import { rebuildProjections } from './rebuild-projections';
import { blobs, events, projects as projectsTable } from './schema';
import type { SqliteEventStore } from './sqlite-event-store';
import { readTar } from './tar';
import type { WriterLock } from './writer-lock';

const decoder = new TextDecoder();

const countOf = (orm: FactoryDatabase, table: SQLiteTable): number =>
  orm.select({ n: count() }).from(table).get()?.n ?? 0;

const highestGlobalSeq = (orm: FactoryDatabase): number =>
  orm
    .select({ n: sql<number | null>`max(${events.globalSeq})` })
    .from(events)
    .get()?.n ?? 0;

const lineCount = (bytes: Uint8Array | undefined): number => {
  if (!bytes || bytes.byteLength === 0) return 0;
  return decoder
    .decode(bytes)
    .split('\n')
    .filter((line) => line.length > 0).length;
};

const countsFromArchive = (archiveBytes: Uint8Array): ArchiveCounts => {
  let globalSeq = 0;
  let projects = 0;
  let events = 0;
  let blobs = 0;
  for (const entry of readTar(archiveBytes)) {
    if (entry.name === 'manifest.json') {
      const manifest = JSON.parse(decoder.decode(entry.bytes)) as {
        globalSeq: number;
      };
      globalSeq = manifest.globalSeq;
    } else if (entry.name === 'projects.jsonl') {
      projects = lineCount(entry.bytes);
    } else if (entry.name === 'events.jsonl') {
      events = lineCount(entry.bytes);
    } else if (entry.name.startsWith('blobs/')) {
      blobs += 1;
    }
  }
  return { globalSeq, projects, events, blobs };
};

/** Refuses to write over an existing file: an export or a backup never replaces anything. */
const assertNew = async (file: string): Promise<void> => {
  if (await Bun.file(file).exists()) {
    throw new Error(`refusing to overwrite ${file}`);
  }
};

/**
 * Backup, export and import over one SQLite connection (STORAGE §7). Every operation runs under the
 * writer lock, and reads go through the store's gate, so a read never sees a half-written command.
 * Export and import delegate to `export-import.ts` (`STORAGE §7.3` tar format).
 */
export const sqliteArchive = (
  db: Database,
  store: SqliteEventStore,
  writer: WriterLock,
): ArchivePort => {
  const orm = drizzleOf(db);
  const counts = (globalSeq: number): ArchiveCounts => ({
    globalSeq,
    projects: countOf(orm, projectsTable),
    events: countOf(orm, events),
    blobs: countOf(orm, blobs),
  });

  return {
    backup: (file) =>
      store.gate.run(async () => {
        writer.assertHeld();
        await assertNew(file);
        // raw: VACUUM INTO takes a file name as a bound parameter; Drizzle has no builder for it.
        db.run('VACUUM INTO ?', [file]);
        return counts(highestGlobalSeq(orm));
      }),

    exportTo: async (file, exportedAt) => {
      await store.gate.run(() => {
        writer.assertHeld();
      });
      await assertNew(file);
      const archiveBytes = await exportFactory(store, exportedAt);
      await Bun.write(file, archiveBytes);
      return countsFromArchive(archiveBytes);
    },

    rebuildProjections: (project) => rebuildProjections(store, project),

    importFrom: async (file, project, importedAt) => {
      await store.gate.run(() => {
        writer.assertHeld();
      });
      const archiveBytes = new Uint8Array(await Bun.file(file).arrayBuffer());
      const result = await importFactory(
        store,
        archiveBytes,
        project,
        importedAt,
      );
      const globalSeq = await store.gate.run(() => highestGlobalSeq(orm));
      return {
        globalSeq,
        projects: result.projects,
        events: result.events,
        blobs: result.blobs,
      };
    },
  };
};
