import type { Database } from 'bun:sqlite';
import { Column, is } from 'drizzle-orm';
import { getTableConfig, SQLiteTable } from 'drizzle-orm/sqlite-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, migrate } from '../migrate';
import * as schema from '../schema';
import { openDatabase } from '../sqlite-event-store';

/** The eleven tables of STORAGE §4, by their SQL names. */
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

/** The shape a table is compared by: columns, indexes, unique constraints and foreign keys. */
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

const drizzleTables = (): SQLiteTable[] => {
  const values: unknown[] = Object.values(schema);
  return values.filter((value): value is SQLiteTable => is(value, SQLiteTable));
};

/** A Drizzle default as the SQL literal `DEFAULT` would hold it (PRAGMA quotes strings). */
const literalOf = (value: unknown): string =>
  typeof value === 'string' ? `'${value}'` : String(value);

const uniqueOf = (columns: string[]): string => `unique(${columns.join(',')})`;

const indexOf = (name: string, unique: boolean, columns: string[]): string =>
  `index(${name}:${unique ? 'unique' : 'plain'}:${columns.join(',')})`;

const drizzleShape = (table: SQLiteTable): TableShape => {
  const config = getTableConfig(table);
  const compositeKey = new Set(
    config.primaryKeys.flatMap((key) =>
      key.columns.map((column) => column.name),
    ),
  );
  const uniques = new Set<string>();
  for (const constraint of config.uniqueConstraints) {
    uniques.add(uniqueOf(constraint.columns.map((column) => column.name)));
  }
  for (const column of config.columns) {
    if (column.isUnique) uniques.add(uniqueOf([column.name]));
  }
  return {
    columns: config.columns.map((column) => {
      const primary = column.primary || compositeKey.has(column.name);
      // Drizzle implies NOT NULL on a key column, SQLite does not store it, so key columns skip it.
      const notNull = primary ? 'key' : String(column.notNull);
      // An autoincrement key has `hasDefault` but no value: SQLite holds no DEFAULT for it.
      const dflt =
        column.default === undefined ? 'null' : literalOf(column.default);
      return `${column.name} ${column.getSQLType().toUpperCase()} notnull=${notNull} pk=${primary} dflt=${dflt}`;
    }),
    indexes: config.indexes.map((index) =>
      indexOf(
        index.config.name,
        index.config.unique,
        index.config.columns.map((column) =>
          is(column, Column) ? column.name : String(column),
        ),
      ),
    ),
    uniques: [...uniques],
    foreignKeys: config.foreignKeys.map((key) => {
      const reference = key.reference();
      const from = reference.columns.map((column) => column.name).join(',');
      const target = getTableConfig(reference.foreignTable).name;
      const to = reference.foreignColumns
        .map((column) => column.name)
        .join(',');
      return `${from}->${target}.${to}`;
    }),
  };
};

const primaryKeyOf = (db: Database, table: string): string[] =>
  db
    .query<TableInfoRow, []>(`PRAGMA table_info(${table})`)
    .all()
    .filter((column) => column.pk > 0)
    .sort((left, right) => left.pk - right.pk)
    .map((column) => column.name);

const sqliteShape = (db: Database, table: string): TableShape => {
  const columns = db
    .query<TableInfoRow, []>(`PRAGMA table_info(${table})`)
    .all()
    .map((column) => {
      const primary = column.pk > 0;
      const notNull = primary ? 'key' : String(column.notnull === 1);
      return `${column.name} ${column.type.toUpperCase()} notnull=${notNull} pk=${primary} dflt=${column.dflt_value ?? 'null'}`;
    });

  const indexes: string[] = [];
  const uniques: string[] = [];
  for (const entry of db
    .query<IndexListRow, []>(`PRAGMA index_list(${table})`)
    .all()) {
    if (entry.origin === 'pk') continue;
    const columns = db
      .query<IndexInfoRow, []>(`PRAGMA index_info(${entry.name})`)
      .all()
      .sort((left, right) => left.seqno - right.seqno)
      .map((column) => column.name);
    if (entry.origin === 'u') {
      uniques.push(uniqueOf(columns));
    } else {
      indexes.push(indexOf(entry.name, entry.unique === 1, columns));
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

  return { columns, indexes, uniques, foreignKeys };
};

describe('the Drizzle schema mirrors the migrations', () => {
  let db: Database;

  beforeAll(() => {
    db = openDatabase(':memory:');
    migrate(db, MIGRATIONS_DIR);
  });

  afterAll(() => {
    db.close();
  });

  it('declares exactly the eleven STORAGE tables', () => {
    const names = drizzleTables()
      .map((table) => getTableConfig(table).name)
      .sort();

    expect(names).toEqual(STORAGE_TABLES);
  });

  it('creates exactly the eleven STORAGE tables from the migration', () => {
    const names = db
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations' ORDER BY name",
      )
      .all()
      .map((row) => row.name);

    expect(names).toEqual(STORAGE_TABLES);
  });

  it.each(
    drizzleTables().map((table) => ({
      tableName: getTableConfig(table).name,
      table,
    })),
  )(
    'matches the columns, indexes and constraints of $tableName',
    ({ tableName, table }) => {
      expect(drizzleShape(table)).toEqual(sqliteShape(db, tableName));
    },
  );
});
