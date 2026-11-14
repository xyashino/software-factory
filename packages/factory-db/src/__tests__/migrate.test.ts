import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  'plans',
  'projects',
  'signals',
  'supervisor_tokens',
];

describe('the migration runner', () => {
  it('creates the twelve STORAGE tables and records every migration on a fresh database', () => {
    const db = openDatabase(':memory:');

    const applied = migrate(db, MIGRATIONS_DIR);

    expect(applied).toEqual([
      '0001_init.sql',
      '0002_join_token_command_id.sql',
      '0003_order_plan.sql',
    ]);
    expect(tableNames(db)).toEqual(
      [...STORAGE_TABLES, 'schema_migrations'].sort(),
    );
    expect(appliedNames(db)).toEqual([
      '0001_init.sql',
      '0002_join_token_command_id.sql',
      '0003_order_plan.sql',
    ]);
  });

  it('applies nothing on a second run', () => {
    const db = openDatabase(':memory:');
    migrate(db, MIGRATIONS_DIR);

    expect(migrate(db, MIGRATIONS_DIR)).toEqual([]);
    expect(appliedNames(db)).toEqual([
      '0001_init.sql',
      '0002_join_token_command_id.sql',
      '0003_order_plan.sql',
    ]);
  });

  it('adds the Order Plan columns to a 0002 database and keeps its Work orders (migration 0003)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'migrate-0003-'));
    for (const name of ['0001_init.sql', '0002_join_token_command_id.sql']) {
      writeFileSync(
        join(dir, name),
        readFileSync(join(MIGRATIONS_DIR, name), 'utf8'),
      );
    }
    const db = openDatabase(':memory:');
    migrate(db, dir);
    db.run(
      "INSERT INTO projects (project_id, repo_url, base_branch, max_running, dep_policy, created_at) VALUES ('shop', 'https://example.com/shop.git', 'main', 2, 'delivered', 1)",
    );
    db.run(
      "INSERT INTO orders (order_id, project_id, todo_id, title, line, priority, depends_on, last_seq, status, holder, next_kind, progressed, resumed, created_at, updated_at) VALUES ('shop:wo-1', 'shop', 'wo-1', 'One', 'feature', 'medium', '[]', 1, 'queued', 'queue', 'job', 0, 0, 1, 1)",
    );

    expect(migrate(db, MIGRATIONS_DIR)).toEqual(['0003_order_plan.sql']);

    const row = db
      .query<{ plan: string | null; base_branch: string; title: string }, []>(
        "SELECT plan, base_branch, title FROM orders WHERE order_id = 'shop:wo-1'",
      )
      .get();
    expect(row).toEqual({ plan: null, base_branch: '', title: 'One' });
    expect(
      db.query("SELECT name FROM sqlite_master WHERE name = 'plans'").all(),
    ).toHaveLength(1);
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
