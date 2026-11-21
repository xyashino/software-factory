import { chmodSync } from 'node:fs';
import { Database } from 'bun:sqlite';
import { type BunSQLiteDatabase, drizzle } from 'drizzle-orm/bun-sqlite';
import type { MigrationMeta } from 'drizzle-orm/migrator';
import type { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';

const MEMORY_PATH = ':memory:';
const DEFAULT_FILE_MODE = 0o600;

const PRAGMAS = [
  'PRAGMA journal_mode = WAL',
  'PRAGMA synchronous = NORMAL',
  'PRAGMA foreign_keys = ON',
  'PRAGMA busy_timeout = 5000',
];

export type BunSqliteSchema = Record<string, unknown>;

export type BunSqliteDb<S extends BunSqliteSchema> = BunSQLiteDatabase<S>;

export type BunSqliteTx<S extends BunSqliteSchema> = Parameters<
  Parameters<BunSqliteDb<S>['transaction']>[0]
>[0];

export type CreateDbOptions<S extends BunSqliteSchema> = {
  schema: S;
  migrations: MigrationMeta[];
  fileMode?: number;
};

// drizzle's public migrate() reads .sql files from disk; the dialect and
// session it wraps are only reachable through these internal fields.
type InternalMigrator = {
  dialect: SQLiteSyncDialect;
  session: Parameters<SQLiteSyncDialect['migrate']>[1];
};

export const createDb = <S extends BunSqliteSchema>(
  sqlitePath: string,
  { schema, migrations, fileMode = DEFAULT_FILE_MODE }: CreateDbOptions<S>,
): BunSqliteDb<S> => {
  const sqlite = new Database(sqlitePath);
  if (sqlitePath !== MEMORY_PATH) chmodSync(sqlitePath, fileMode);
  for (const pragma of PRAGMAS) sqlite.exec(pragma);
  const db = drizzle(sqlite, { schema });
  const { dialect, session } = db as unknown as InternalMigrator;
  dialect.migrate(migrations, session);
  return db;
};
