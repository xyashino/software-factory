import type { Database } from 'bun:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The numbered SQL files of this package (STORAGE §9). */
export const MIGRATIONS_DIR = fileURLToPath(
  new URL('../migrations', import.meta.url),
);

const MIGRATION_FILE = /^\d{4}_[a-z0-9_]+\.sql$/;

interface MigrationFile {
  name: string;
  sql: string;
}

const migrationFilesIn = (dir: string): MigrationFile[] =>
  readdirSync(dir)
    .filter((name) => MIGRATION_FILE.test(name))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(dir, name), 'utf8') }));

const appliedNames = (db: Database): string[] =>
  db
    .query<{ name: string }, []>(
      'SELECT name FROM schema_migrations ORDER BY name',
    )
    .all()
    .map((row) => row.name);

/**
 * Applies every pending migration in `dir`, forward only. All pending files run in one
 * `BEGIN IMMEDIATE` transaction, each recorded in `schema_migrations`; a failure rolls the whole
 * batch back. An applied file that is missing from `dir` is an error: history is not rewritten.
 * Returns the names applied by this call (empty on a re-run).
 */
export const migrate = (
  db: Database,
  dir: string = MIGRATIONS_DIR,
): string[] => {
  const files = migrationFilesIn(dir);
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(
      'CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)',
    );
    const applied = appliedNames(db);
    const known = new Set(files.map((file) => file.name));
    const missing = applied.filter((name) => !known.has(name));
    if (missing.length > 0) {
      throw new Error(
        `applied migrations missing from ${dir}: ${missing.join(', ')}`,
      );
    }
    const pending = files.filter((file) => !applied.includes(file.name));
    for (const file of pending) {
      db.exec(file.sql);
      db.run('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)', [
        file.name,
        Date.now(),
      ]);
    }
    db.exec('COMMIT');
    return pending.map((file) => file.name);
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
};
