import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, it } from 'vitest';
import {
  defineEventStoreContract,
  type StoreFactory,
} from '@repo/factory-core/testing';
import { loadOrders } from '../orders-table';
import { MIGRATIONS_DIR, migrate } from '../migrate';
import { openDatabase, openSqliteEventStore } from '../sqlite-event-store';
import { seedProject } from './helpers';

/** A SQLite store over a fresh database made by `locate`, migrated and ready for the contract. */
const sqliteUnderTest =
  (locate: () => string): StoreFactory =>
  async () => {
    const db = openDatabase(locate());
    migrate(db, MIGRATIONS_DIR);
    return {
      store: openSqliteEventStore(db),
      seedProject: async () => seedProject(db),
      orders: async () => loadOrders(db),
      close: async () => db.close(),
    };
  };

const dir = mkdtempSync(join(tmpdir(), 'factory-db-contract-'));
let counter = 0;

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

defineEventStoreContract(
  { describe, it },
  'SQLite in memory',
  sqliteUnderTest(() => ':memory:'),
);

defineEventStoreContract(
  { describe, it },
  'SQLite on a file (WAL)',
  sqliteUnderTest(() => {
    counter += 1;
    return join(dir, `factory-${counter}.db`);
  }),
);
