import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { createDb } from '../create-db';
import { immediateTx } from '../immediate-tx';
import { items, migrations, schema } from './fixture';

const scratch: string[] = [];

const freshDbPath = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'bun-sqlite-kit-'));
  scratch.push(dir);
  return join(dir, 'app.db');
};

afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true });
});

describe('immediateTx', () => {
  it('commits the writes when the callback returns', () => {
    const db = createDb(':memory:', { schema, migrations });

    immediateTx(db, (tx) => {
      tx.insert(items).values({ name: 'committed' }).run();
    });

    expect(db.select().from(items).all()).toEqual([
      { id: 1, name: 'committed' },
    ]);
  });

  it('rolls back the writes when the callback throws', () => {
    const db = createDb(':memory:', { schema, migrations });

    const attempt = () =>
      immediateTx(db, (tx) => {
        tx.insert(items).values({ name: 'discarded' }).run();
        throw new Error('boom');
      });

    expect(attempt).toThrow('boom');
    expect(db.select().from(items).all()).toEqual([]);
  });

  it('takes the write lock when it starts', () => {
    const path = freshDbPath();
    const db = createDb(path, { schema, migrations });
    const other = new Database(path);
    other.exec('PRAGMA busy_timeout = 0');

    immediateTx(db, () => {
      expect(() => other.exec('BEGIN IMMEDIATE')).toThrow(/locked/);
    });

    other.close();
  });
});
