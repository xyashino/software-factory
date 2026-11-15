import type { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LEGACY_MIGRATIONS_DIR, MIGRATIONS_DIR, migrate } from '../migrate';
import { openDatabase } from '../sqlite-event-store';

/** The eleven tables of STORAGE §4, by their SQL names. */
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

const LEGACY_FILES = [
  '0001_init.sql',
  '0002_join_token_command_id.sql',
  '0003_order_plan.sql',
];

/** The shape a table is compared by. Unique constraints and unique indexes are one kind here. */
interface TableShape {
  columns: string[];
  indexes: string[];
  uniques: string[];
  foreignKeys: string[];
}

interface TableInfoRow {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

interface IndexListRow {
  name: string;
  unique: number;
  origin: string;
}

interface IndexInfoRow {
  seqno: number;
  name: string;
}

interface ForeignKeyRow {
  table: string;
  from: string;
  to: string | null;
}

const tableNames = (db: Database): string[] =>
  db
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations' ORDER BY name",
    )
    .all()
    .map((row) => row.name);

const primaryKeyOf = (db: Database, table: string): string[] =>
  db
    .query<TableInfoRow, []>(`PRAGMA table_info(${table})`)
    .all()
    .filter((column) => column.pk > 0)
    .sort((left, right) => left.pk - right.pk)
    .map((column) => column.name);

const shapeOf = (db: Database, table: string): TableShape => {
  const columns = db
    .query<TableInfoRow, []>(`PRAGMA table_info(${table})`)
    .all()
    .map((column) => {
      // A key column is NOT NULL by the SQL it is declared with, not by a flag: compare it as a key.
      const notNull = column.pk > 0 ? 'key' : String(column.notnull === 1);
      return `${column.name} ${column.type.toUpperCase()} notnull=${notNull} pk=${column.pk > 0} dflt=${column.dflt_value ?? 'null'}`;
    });

  const indexes: string[] = [];
  const uniques: string[] = [];
  for (const entry of db
    .query<IndexListRow, []>(`PRAGMA index_list(${table})`)
    .all()) {
    if (entry.origin === 'pk') continue;
    const indexed = db
      .query<IndexInfoRow, []>(`PRAGMA index_info(${entry.name})`)
      .all()
      .sort((left, right) => left.seqno - right.seqno)
      .map((column) => column.name)
      .join(',');
    if (entry.unique === 1) {
      uniques.push(`unique(${indexed})`);
    } else {
      indexes.push(`${entry.name}(${indexed})`);
    }
  }

  const foreignKeys = db
    .query<ForeignKeyRow, []>(`PRAGMA foreign_key_list(${table})`)
    .all()
    .map((key) => {
      // An implicit target (`REFERENCES projects`) is the target's primary key.
      const to = key.to ?? primaryKeyOf(db, key.table).join(',');
      return `${key.from}->${key.table}.${to}`;
    });

  return {
    columns,
    indexes: indexes.sort(),
    uniques: uniques.sort(),
    foreignKeys,
  };
};

const schemaOf = (db: Database): Record<string, TableShape> =>
  Object.fromEntries(
    tableNames(db).map((table) => [table, shapeOf(db, table)]),
  );

/**
 * A database built the way the hand-written migrations 0001-0003 built it, then the generated drop of
 * the `intake` table, with no history.
 */
const legacySchema = (): Database => {
  const db = openDatabase(':memory:');
  for (const name of LEGACY_FILES) {
    db.exec(readFileSync(join(LEGACY_MIGRATIONS_DIR, name), 'utf8'));
  }
  db.exec(readFileSync(join(MIGRATIONS_DIR, '0001_drop_intake.sql'), 'utf8'));
  return db;
};

describe('the schema.ts baseline', () => {
  it('builds the same schema as migrations 0001-0003 and the intake drop', () => {
    const fresh = openDatabase(':memory:');
    migrate(fresh, MIGRATIONS_DIR);

    const legacy = legacySchema();

    expect(Object.keys(schemaOf(fresh))).toEqual(STORAGE_TABLES);
    expect(schemaOf(fresh)).toEqual(schemaOf(legacy));
  });
});
