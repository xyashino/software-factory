import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDb, immediateTx } from '../../src/db/client';
import { createTempDbPath } from '../support/test-db';

const INSERT_SETTING = sql`INSERT INTO settings (key, value_json, created_at, updated_at) VALUES ('host', '"127.0.0.1"', 1, 1)`;

describe('immediate transactions', () => {
  it('commits a write made inside an immediate transaction', () => {
    const db = createDb(createTempDbPath());

    immediateTx(db, (tx) => {
      tx.run(INSERT_SETTING);
    });

    expect(db.all(sql`SELECT count(*) AS n FROM settings`)).toEqual([{ n: 1 }]);
  });

  it('rolls back the write when the transaction throws', () => {
    const db = createDb(createTempDbPath());

    expect(() =>
      immediateTx(db, (tx) => {
        tx.run(INSERT_SETTING);
        throw new Error('abort');
      }),
    ).toThrow('abort');

    expect(db.all(sql`SELECT count(*) AS n FROM settings`)).toEqual([{ n: 0 }]);
  });

  it('keeps a second writer out while the first holds the write lock', () => {
    const path = createTempDbPath();
    const first = createDb(path);
    const second = createDb(path);

    const attempt = () =>
      immediateTx(first, () => {
        immediateTx(second, () => undefined);
      });

    expect(attempt).toThrow(/locked|BUSY/);
  });
});
