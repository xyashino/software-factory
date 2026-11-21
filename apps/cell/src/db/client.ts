import { chmodSync } from 'node:fs';
import { Database } from 'bun:sqlite';
import { type BunSQLiteDatabase, drizzle } from 'drizzle-orm/bun-sqlite';
import type { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import { cells } from './schema/cells';
import { factories } from './schema/factories';
import { settings } from './schema/settings';
import { embeddedMigrationsOf } from './migrations';

const schema = { factories, cells, settings };

const MEMORY_PATH = ':memory:';
const DB_FILE_MODE = 0o600;

const PRAGMAS = [
  'PRAGMA journal_mode = WAL',
  'PRAGMA synchronous = NORMAL',
  'PRAGMA foreign_keys = ON',
  'PRAGMA busy_timeout = 5000',
];

export type Db = BunSQLiteDatabase<typeof schema>;

export type DbTx = Parameters<Parameters<Db['transaction']>[0]>[0];

// drizzle's public migrate() reads .sql files from disk; the dialect and
// session it wraps are only reachable through these internal fields.
type InternalMigrator = {
  dialect: SQLiteSyncDialect;
  session: Parameters<SQLiteSyncDialect['migrate']>[1];
};

export const createDb = (sqlitePath: string): Db => {
  const sqlite = new Database(sqlitePath);
  if (sqlitePath !== MEMORY_PATH) chmodSync(sqlitePath, DB_FILE_MODE);
  for (const pragma of PRAGMAS) sqlite.exec(pragma);
  const db = drizzle(sqlite, { schema });
  const { dialect, session } = db as unknown as InternalMigrator;
  dialect.migrate(embeddedMigrationsOf(), session);
  return db;
};

export const immediateTx = <T>(db: Db, fn: (tx: DbTx) => T): T =>
  db.transaction(fn, { behavior: 'immediate' });
