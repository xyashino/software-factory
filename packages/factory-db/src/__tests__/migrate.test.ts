import type { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LEGACY_MIGRATIONS_DIR, MIGRATIONS_DIR, migrate } from '../migrate';
import { openDatabase } from '../sqlite-event-store';

const fixtureDir = (name: string): string =>
  fileURLToPath(new URL(`./migrations/${name}`, import.meta.url));

const BASELINE = '0000_baseline';
const DROP_INTAKE = '0001_drop_intake';

const LEGACY_FILES = [
  '0001_init.sql',
  '0002_join_token_command_id.sql',
  '0003_order_plan.sql',
];

const STORAGE_TABLES = [
  'blobs',
  'cells',
  'commands',
  'events',
  'join_tokens',
  'leases',
  'orders',
  'plans',
  'projects',
  'signals',
  'supervisor_tokens',
];

const tableNames = (db: Database): string[] =>
  db
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations' ORDER BY name",
    )
    .all()
    .map((row) => row.name);

const appliedNames = (db: Database): string[] =>
  db
    .query<{ name: string }, []>(
      'SELECT name FROM schema_migrations ORDER BY name',
    )
    .all()
    .map((row) => row.name);

/** Every schema object as SQLite stores it: a change to any of them shows here. */
const schemaObjects = (db: Database): string =>
  JSON.stringify(
    db.query('SELECT type, name, sql FROM sqlite_master ORDER BY name').all(),
  );

/**
 * A database as the hand-written runner left it: the legacy files `names` applied, each recorded in
 * `schema_migrations`.
 */
const legacyDatabase = (names: string[]): Database => {
  const db = openDatabase(':memory:');
  db.exec(
    'CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)',
  );
  for (const name of names) {
    db.exec(readFileSync(join(LEGACY_MIGRATIONS_DIR, name), 'utf8'));
    db.run('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)', [
      name,
      1,
    ]);
  }
  return db;
};

const seedWorkOrder = (db: Database): void => {
  db.run(
    "INSERT INTO projects (project_id, repo_url, base_branch, max_running, dep_policy, created_at) VALUES ('shop', 'https://example.com/shop.git', 'main', 2, 'delivered', 1)",
  );
  db.run(
    "INSERT INTO orders (order_id, project_id, todo_id, title, line, priority, depends_on, last_seq, status, holder, next_kind, progressed, resumed, created_at, updated_at) VALUES ('shop:wo-1', 'shop', 'wo-1', 'One', 'feature', 'medium', '[]', 1, 'queued', 'queue', 'job', 0, 0, 1, 1)",
  );
};

const workOrders = (db: Database): string =>
  JSON.stringify(db.query('SELECT * FROM orders ORDER BY order_id').all());

describe('the migration runner on a fresh database', () => {
  it('creates the eleven STORAGE tables and records the baseline', () => {
    const db = openDatabase(':memory:');

    const applied = migrate(db, MIGRATIONS_DIR);

    expect(applied).toEqual([BASELINE, DROP_INTAKE]);
    expect(tableNames(db)).toEqual(STORAGE_TABLES);
    expect(appliedNames(db)).toEqual([BASELINE, DROP_INTAKE]);
  });

  it('applies nothing on a second run', () => {
    const db = openDatabase(':memory:');
    migrate(db, MIGRATIONS_DIR);

    expect(migrate(db, MIGRATIONS_DIR)).toEqual([]);
    expect(appliedNames(db)).toEqual([BASELINE, DROP_INTAKE]);
  });

  it('applies only the migrations that are new', () => {
    const db = openDatabase(':memory:');
    migrate(db, fixtureDir('one'));

    const applied = migrate(db, fixtureDir('two'));

    expect(applied).toEqual(['0001_second']);
    expect(tableNames(db)).toEqual(['first_table', 'second_table']);
  });

  it('rolls every pending migration back when one of them fails', () => {
    const db = openDatabase(':memory:');

    expect(() => migrate(db, fixtureDir('bad'))).toThrow();

    expect(tableNames(db)).toEqual([]);
  });

  it('refuses a directory that no longer has an applied migration', () => {
    const db = openDatabase(':memory:');
    migrate(db, fixtureDir('one'));

    expect(() => migrate(db, fixtureDir('renamed'))).toThrow(/missing/);
    expect(appliedNames(db)).toEqual(['0000_first']);
  });

  it('refuses a database that has tables but no migration history', () => {
    const db = openDatabase(':memory:');
    db.exec('CREATE TABLE projects (project_id TEXT PRIMARY KEY)');

    expect(() => migrate(db, MIGRATIONS_DIR)).toThrow(
      /unknown migration state/,
    );
    expect(tableNames(db)).toEqual(['projects']);
  });
});

describe('adopting the baseline on a legacy database', () => {
  it('records the baseline without running it and keeps the data', () => {
    const db = legacyDatabase(LEGACY_FILES);
    seedWorkOrder(db);
    const orders = workOrders(db);

    const applied = migrate(db, MIGRATIONS_DIR);

    expect(applied).toEqual([DROP_INTAKE]);
    expect(appliedNames(db)).toEqual(
      [...LEGACY_FILES, BASELINE, DROP_INTAKE].sort(),
    );
    expect(tableNames(db)).not.toContain('intake');
    expect(workOrders(db)).toEqual(orders);
  });

  it('applies nothing once the baseline is adopted', () => {
    const db = legacyDatabase(LEGACY_FILES);
    migrate(db, MIGRATIONS_DIR);

    expect(migrate(db, MIGRATIONS_DIR)).toEqual([]);
  });

  it('runs the legacy files a pre-0003 database lacks, then adopts the baseline', () => {
    const db = legacyDatabase(['0001_init.sql']);
    seedWorkOrder(db);

    const applied = migrate(db, MIGRATIONS_DIR);

    expect(applied).toEqual([
      '0002_join_token_command_id.sql',
      '0003_order_plan.sql',
      DROP_INTAKE,
    ]);
    expect(appliedNames(db)).toEqual(
      [...LEGACY_FILES, BASELINE, DROP_INTAKE].sort(),
    );
    expect(
      db
        .query<{ plan: string | null; base_branch: string; title: string }, []>(
          "SELECT plan, base_branch, title FROM orders WHERE order_id = 'shop:wo-1'",
        )
        .get(),
    ).toEqual({ plan: null, base_branch: '', title: 'One' });
    expect(tableNames(db)).toEqual(STORAGE_TABLES);
  });

  it.each([
    ['only migration 0002', ['0002_join_token_command_id.sql']],
    ['a gap, 0001 and 0003', ['0001_init.sql', '0003_order_plan.sql']],
    ['a name the runner does not know', [...LEGACY_FILES, 'mystery.sql']],
  ])(
    'refuses a legacy database with %s and leaves it unchanged',
    (_label, names) => {
      const db = openDatabase(':memory:');
      db.exec(
        'CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)',
      );
      for (const name of names) {
        db.run(
          'INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)',
          [name, 1],
        );
      }
      const before = schemaObjects(db);

      expect(() => migrate(db, MIGRATIONS_DIR)).toThrow(/unknown|missing/);

      expect(schemaObjects(db)).toEqual(before);
      expect(appliedNames(db)).toEqual([...names].sort());
    },
  );
});
