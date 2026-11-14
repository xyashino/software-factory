import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, migrate } from '../migrate';
import { openDatabase } from '../sqlite-event-store';

const fixtureDir = (name: string): string =>
  fileURLToPath(new URL(`./migrations/${name}`, import.meta.url));

const tableNames = (db: ReturnType<typeof openDatabase>): string[] =>
  db
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map((row) => row.name);

const appliedNames = (db: ReturnType<typeof openDatabase>): string[] =>
  db
    .query<{ name: string }, []>(
      'SELECT name FROM schema_migrations ORDER BY name',
    )
    .all()
    .map((row) => row.name);

const STORAGE_TABLES = [
  'blobs',
  'cells',
  'commands',
  'events',
  'intake',
  'join_tokens',
  'leases',
  'orders',
  'projects',
  'signals',
  'supervisor_tokens',
];

describe('the migration runner', () => {
  it('creates the eleven STORAGE tables and records every migration on a fresh database', () => {
    const db = openDatabase(':memory:');

    const applied = migrate(db, MIGRATIONS_DIR);

    expect(applied).toEqual([
      '0001_init.sql',
      '0002_join_token_command_id.sql',
    ]);
    expect(tableNames(db)).toEqual(
      [...STORAGE_TABLES, 'schema_migrations'].sort(),
    );
    expect(appliedNames(db)).toEqual([
      '0001_init.sql',
      '0002_join_token_command_id.sql',
    ]);
  });

  it('applies nothing on a second run', () => {
    const db = openDatabase(':memory:');
    migrate(db, MIGRATIONS_DIR);

    expect(migrate(db, MIGRATIONS_DIR)).toEqual([]);
    expect(appliedNames(db)).toEqual([
      '0001_init.sql',
      '0002_join_token_command_id.sql',
    ]);
  });

  it('applies only the files that are new', () => {
    const db = openDatabase(':memory:');
    migrate(db, fixtureDir('one'));

    const applied = migrate(db, fixtureDir('two'));

    expect(applied).toEqual(['0002_second.sql']);
    expect(tableNames(db)).toEqual([
      'first_table',
      'schema_migrations',
      'second_table',
    ]);
  });

  it('rolls every pending file back when one of them fails', () => {
    const db = openDatabase(':memory:');

    expect(() => migrate(db, fixtureDir('bad'))).toThrow();

    expect(tableNames(db)).toEqual([]);
  });

  it('refuses a directory that no longer has an applied file', () => {
    const db = openDatabase(':memory:');
    migrate(db, fixtureDir('one'));

    expect(() => migrate(db, fixtureDir('renamed'))).toThrow(/missing/);
    expect(appliedNames(db)).toEqual(['0001_first.sql']);
  });
});
