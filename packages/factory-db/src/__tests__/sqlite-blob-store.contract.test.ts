import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, it } from 'vitest';
import {
  type BlobFactory,
  defineBlobStoreContract,
} from '@repo/factory-core/testing';
import { MIGRATIONS_DIR, migrate } from '../migrate';
import { blobRefOf, sqliteBlobStore } from '../sqlite-blob-store';
import { openDatabase, openSqliteEventStore } from '../sqlite-event-store';
import { acquireWriter, type WriterLock } from '../writer-lock';

const dir = mkdtempSync(join(tmpdir(), 'factory-db-blobs-'));
let counter = 0;

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A SQLite blob store over a fresh migrated database, reading `created_at` from the test clock. */
const sqliteUnderTest =
  (locate: () => string): BlobFactory =>
  async (clock) => {
    const db = openDatabase(locate());
    migrate(db, MIGRATIONS_DIR);
    const store = openSqliteEventStore(db);
    const writer: WriterLock = acquireWriter(mkdtempSync(join(dir, 'writer-')));
    return {
      store: sqliteBlobStore(db, writer, store.gate, clock),
      close: async () => {
        writer.release();
        db.close();
      },
    };
  };

defineBlobStoreContract(
  { describe, it },
  'SQLite in memory',
  blobRefOf,
  sqliteUnderTest(() => ':memory:'),
);

defineBlobStoreContract(
  { describe, it },
  'SQLite on a file (WAL)',
  blobRefOf,
  sqliteUnderTest(() => {
    counter += 1;
    return join(dir, `blobs-${counter}.db`);
  }),
);
