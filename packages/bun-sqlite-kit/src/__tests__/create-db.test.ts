import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { createDb } from '../create-db';
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

describe('createDb', () => {
  it('migrates a fresh in-memory database so tables are usable', () => {
    const db = createDb(':memory:', { schema, migrations });

    db.insert(items).values({ name: 'first' }).run();

    expect(db.select().from(items).all()).toEqual([{ id: 1, name: 'first' }]);
  });

  it('opens file databases in WAL mode with foreign keys and busy timeout', () => {
    const db = createDb(freshDbPath(), { schema, migrations });

    const [journal] = db.all<{ journal_mode: string }>(
      sql`PRAGMA journal_mode`,
    );
    const [foreignKeys] = db.all<{ foreign_keys: number }>(
      sql`PRAGMA foreign_keys`,
    );
    const [busyTimeout] = db.all<{ timeout: number }>(sql`PRAGMA busy_timeout`);

    expect(journal?.journal_mode).toBe('wal');
    expect(foreignKeys?.foreign_keys).toBe(1);
    expect(busyTimeout?.timeout).toBe(5000);
  });

  it('restricts a new file database to owner read and write', () => {
    const path = freshDbPath();

    createDb(path, { schema, migrations });

    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('honors a custom file mode', () => {
    const path = freshDbPath();

    createDb(path, { schema, migrations, fileMode: 0o640 });

    expect(statSync(path).mode & 0o777).toBe(0o640);
  });

  it('does not throw for in-memory databases', () => {
    expect(() => createDb(':memory:', { schema, migrations })).not.toThrow();
  });

  it('keeps the schema typed on the returned database', () => {
    const db = createDb(':memory:', { schema, migrations });

    const rows: { id: number; name: string }[] = db.query.items
      .findMany()
      .sync();

    expect(rows).toEqual([]);
  });

  it('keeps data and does not re-apply migrations when reopened', () => {
    const path = freshDbPath();
    const first = createDb(path, { schema, migrations });
    first.insert(items).values({ name: 'kept' }).run();

    const reopened = createDb(path, { schema, migrations });

    expect(reopened.select().from(items).all()).toEqual([
      { id: 1, name: 'kept' },
    ]);
    const [applied] = reopened.all<{ n: number }>(
      sql`SELECT count(*) AS n FROM __drizzle_migrations`,
    );
    expect(applied?.n).toBe(1);
  });
});
