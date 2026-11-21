import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDb, immediateTx } from '../../src/db/client';
import { createTempDbPath } from '../support/test-db';

describe('immediate transactions', () => {
  it('commits a write made inside an immediate transaction', () => {
    const db = createDb(createTempDbPath());

    immediateTx(db, (tx) => {
      tx.run(
        sql`INSERT INTO projects (project_id, repo_url, default_base_branch, max_running, created_at, updated_at) VALUES ('proj-1', 'r', 'main', 1, 1, 1)`,
      );
    });

    const count = db.all<{ n: number }>(
      sql`SELECT count(*) AS n FROM projects`,
    );
    expect(count).toEqual([{ n: 1 }]);
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
