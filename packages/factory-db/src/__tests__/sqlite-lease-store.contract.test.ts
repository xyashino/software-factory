import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, it } from 'vitest';
import type { CellId } from '@repo/factory-core/ids';
import {
  defineLeaseStoreContract,
  type LeaseFactory,
} from '@repo/factory-core/testing';
import { drizzleOf } from '../db';
import { MIGRATIONS_DIR, migrate } from '../migrate';
import { cells } from '../schema';
import { openDatabase, openSqliteEventStore } from '../sqlite-event-store';
import { sqliteLeaseStore } from '../sqlite-lease-store';
import { acquireWriter, type WriterLock } from '../writer-lock';

const dir = mkdtempSync(join(tmpdir(), 'factory-db-leases-'));
let counter = 0;

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A SQLite lease store over a fresh migrated database, with the writer lock held for the test. */
const sqliteUnderTest =
  (locate: () => string): LeaseFactory =>
  async () => {
    const db = openDatabase(locate());
    migrate(db, MIGRATIONS_DIR);
    const store = openSqliteEventStore(db);
    const writer: WriterLock = acquireWriter(mkdtempSync(join(dir, 'writer-')));
    const orm = drizzleOf(db);
    return {
      store: sqliteLeaseStore(db, writer, store.gate),
      seedCell: async (cellId: CellId) => {
        orm
          .insert(cells)
          .values({
            cellId,
            name: 'test cell',
            tokenHash: 'hash',
            joinedAt: 0,
          })
          .run();
      },
      close: async () => {
        writer.release();
        db.close();
      },
    };
  };

defineLeaseStoreContract(
  { describe, it },
  'SQLite in memory',
  sqliteUnderTest(() => ':memory:'),
);

defineLeaseStoreContract(
  { describe, it },
  'SQLite on a file (WAL)',
  sqliteUnderTest(() => {
    counter += 1;
    return join(dir, `leases-${counter}.db`);
  }),
);
