import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { sqliteTable, integer } from 'drizzle-orm/sqlite-core';
import { describe, expect, it } from 'vitest';
import { idText, jsonColumn, timestamps } from '../columns';

const records = sqliteTable('records', {
  id: integer('id').primaryKey(),
  ...timestamps(),
  payload: jsonColumn<{ count: number }>('payload'),
  code: idText<'abc'>('code'),
});

const openDb = () => {
  const sqlite = new Database(':memory:');
  sqlite.exec(`CREATE TABLE records (
    id integer PRIMARY KEY NOT NULL,
    created_at integer NOT NULL,
    updated_at integer NOT NULL,
    payload text,
    code text
  )`);
  return { sqlite, db: drizzle(sqlite) };
};

describe('columns', () => {
  it('rejects a record that leaves timestamps empty', () => {
    const { sqlite } = openDb();

    const insert = () =>
      sqlite.exec(
        "INSERT INTO records (id, payload, code) VALUES (1, '{}', 'abc')",
      );

    expect(insert).toThrow(/NOT NULL/);
  });

  it('round-trips a JSON payload', () => {
    const { db } = openDb();

    db.insert(records)
      .values({
        id: 1,
        createdAt: 1,
        updatedAt: 1,
        payload: { count: 7 },
        code: 'abc',
      })
      .run();

    expect(db.select({ payload: records.payload }).from(records).all()).toEqual(
      [{ payload: { count: 7 } }],
    );
  });

  it('stores identifiers as plain text', () => {
    const { db, sqlite } = openDb();
    db.insert(records)
      .values({ id: 1, createdAt: 1, updatedAt: 1, payload: null, code: 'abc' })
      .run();

    const stored = sqlite
      .query<{ kind: string }, []>('SELECT typeof(code) AS kind FROM records')
      .get();

    expect(stored?.kind).toBe('text');
  });
});
