import type { Database } from 'bun:sqlite';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { basename } from 'node:path';
import { count, sql } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import type {
  ArchiveCounts,
  ArchivePort,
} from '@repo/factory-core/ports/archive';
import { type FactoryDatabase, drizzleOf } from './db';
import { TMP_PREFIX } from './file-blob-store';
import { exportFactory, importFactory } from './export-import';
import { rebuildProjections } from './rebuild-projections';
import { blobFiles, blobs, events, projects as projectsTable } from './schema';
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

// Refuses to write over an existing file: an export or a backup never replaces anything.
const assertNew = async (file: string): Promise<void> => {
  if (await Bun.file(file).exists()) {
    throw new Error(`refusing to overwrite ${file}`);
  }
};

/** The directory beside a backup file that holds its log files: `<file>.blobs`. */
const backupBlobDirOf = (file: string): string => `${file}.blobs`;

/**
 * Copies the log files into `<file>.blobs`. `VACUUM INTO` copies only the database, so a backup
 * without this directory would hold events that point at missing logs. A failed copy removes both
 * the backup and its directory.
 */
const copyBlobDir = (blobDir: string, file: string): void => {
  const target = backupBlobDirOf(file);
  if (existsSync(target)) {
    throw new Error(`refusing to overwrite ${target}`);
  }
  try {
    mkdirSync(target, { recursive: true });
    if (existsSync(blobDir)) {
      cpSync(blobDir, target, {
        recursive: true,
        filter: (source) => !basename(source).startsWith(TMP_PREFIX),
      });
    }
  } catch (error) {
    rmSync(file, { force: true });
    rmSync(target, { recursive: true, force: true });
    throw error;
  }
};

/**
 * Backup, export and import over one SQLite connection. Every operation runs under the
 * writer lock, and reads go through the store's gate, so a read never sees a half-written command.
 * Export and import delegate to `export-import.ts` (tar format). `blobDir` is the directory of log files.
 */
export const sqliteArchive = (
  db: Database,
  store: SqliteEventStore,
  writer: WriterLock,
  blobDir: string,
): ArchivePort => {
  const orm = drizzleOf(db);
  const counts = (globalSeq: number): ArchiveCounts => ({
    globalSeq,
    projects: countOf(orm, projectsTable),
    events: countOf(orm, events),
    blobs: countOf(orm, blobs) + countOf(orm, blobFiles),
  });

  return {
    backup: (file) =>
      store.gate.run(async () => {
        writer.assertHeld();
        await assertNew(file);
        // raw: VACUUM INTO takes a file name as a bound parameter; Drizzle has no builder for it.
        db.run('VACUUM INTO ?', [file]);
        copyBlobDir(blobDir, file);
        return counts(highestGlobalSeq(orm));
      }),

    exportTo: async (file, exportedAt) => {
      await store.gate.run(() => {
        writer.assertHeld();
      });
      await assertNew(file);
      const archiveBytes = await exportFactory(store, exportedAt, blobDir);
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
        blobDir,
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
