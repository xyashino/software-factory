import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, it } from 'vitest';
import {
  defineEventStoreContract,
  type StoreFactory,
} from '@repo/factory-core/testing';
import { drizzleOf } from '../db';
import { loadOrders } from '../orders-table';
import { loadPlans } from '../plans-table';
import { MIGRATIONS_DIR, migrate } from '../migrate';
import {
  openDatabase,
  openReadDatabase,
  openSqliteEventStore,
} from '../sqlite-event-store';
import { seedProject } from './helpers';

/**
 * A SQLite store over a fresh database made by `locate`, migrated and ready for the contract. A file
 * database also gets its read-only WAL connection, so the contract runs the split read path too.
 */
const sqliteUnderTest =
  (locate: () => string): StoreFactory =>
  async () => {
    const file = locate();
    const db = openDatabase(file);
    migrate(db, MIGRATIONS_DIR);
    const readDb = file === ':memory:' ? undefined : openReadDatabase(file);
    return {
      store: openSqliteEventStore(db, readDb),
      seedProject: async () => seedProject(db),
      orders: async () => loadOrders(drizzleOf(db)),
      plans: async () => loadPlans(drizzleOf(db)),
      close: async () => {
        readDb?.close();
        db.close();
      },
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
