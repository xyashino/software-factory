import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createDb } from '../../src/db/client';
import { embeddedMigrationsOf } from '../../src/db/migrations';
import { createTempDbPath } from '../support/test-db';

const MIGRATIONS_DIR = fileURLToPath(
  new URL('../../src/db/migrations/', import.meta.url),
);

const TABLES = ['factories', 'cells', 'settings'];

interface Journal {
  entries: { tag: string; when: number }[];
}

const sha256 = (text: string): string =>
  createHash('sha256').update(text).digest('hex');

const journalOf = (): Journal =>
  JSON.parse(readFileSync(join(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf8'));

const sqlOnDisk = (tag: string): string =>
  readFileSync(join(MIGRATIONS_DIR, `${tag}.sql`), 'utf8');

const tableNames = (db: ReturnType<typeof createDb>): string[] =>
  db
    .all<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type = 'table'`,
    )
    .map((table) => table.name);

describe('embedded migrations', () => {
  it('applies the schema on a fresh in-memory database', () => {
    // Arrange
    // Act
    const db = createDb(':memory:');

    // Assert
    expect(tableNames(db)).toEqual(expect.arrayContaining(TABLES));
  });

  it('applies the schema on a fresh database file', () => {
    // Arrange
    const path = createTempDbPath();

    // Act
    const db = createDb(path);

    // Assert
    expect(tableNames(db)).toEqual(expect.arrayContaining(TABLES));
  });

  it('keeps existing data when the same file is opened again', () => {
    // Arrange
    const path = createTempDbPath();
    const first = createDb(path);
    first.run(
      sql`INSERT INTO settings (key, value_json, created_at, updated_at) VALUES ('host', '"127.0.0.1"', 1, 1)`,
    );

    // Act
    const reopened = createDb(path);

    // Assert
    expect(reopened.all(sql`SELECT key FROM settings`)).toEqual([
      { key: 'host' },
    ]);
  });

  it('embeds each journal migration with the SQL on disk', () => {
    // Arrange
    const journal = journalOf();

    // Act
    const embedded = embeddedMigrationsOf();

    // Assert
    expect(embedded.map((migration) => migration.folderMillis)).toEqual(
      journal.entries.map((entry) => entry.when),
    );
    expect(embedded.map((migration) => migration.hash)).toEqual(
      journal.entries.map((entry) => sha256(sqlOnDisk(entry.tag))),
    );
  });

  it('lists every migration file on disk in the journal', () => {
    // Arrange
    const journal = journalOf();
    const onDisk = readdirSync(MIGRATIONS_DIR)
      .filter((file) => file.endsWith('.sql'))
      .map((file) => file.slice(0, -'.sql'.length));

    // Act
    const tags = journal.entries.map((entry) => entry.tag);

    // Assert
    expect([...tags].sort()).toEqual([...onDisk].sort());
  });
});
