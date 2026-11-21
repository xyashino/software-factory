import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDb } from '../../src/db/client';
import { createTempDbPath } from '../support/test-db';

describe('connection pragmas', () => {
  it('runs a file database in write-ahead log mode', () => {
    const db = createDb(createTempDbPath());

    expect(db.all(sql`PRAGMA journal_mode`)).toEqual([{ journal_mode: 'wal' }]);
  });

  it('enforces foreign keys on every connection', () => {
    const db = createDb(createTempDbPath());

    expect(db.all(sql`PRAGMA foreign_keys`)).toEqual([{ foreign_keys: 1 }]);
  });
});
