import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { projectIdSchema } from '@repo/factory-core/ids';
import {
  defineProjectStoreContract,
  type ProjectFactory,
} from '@repo/factory-core/testing';
import { MIGRATIONS_DIR, migrate } from '../migrate';
import { sqliteProjectStore } from '../projects-table';
import { openDatabase, openSqliteEventStore } from '../sqlite-event-store';
import { acquireWriter } from '../writer-lock';

const dir = mkdtempSync(join(tmpdir(), 'factory-db-projects-'));
let counter = 0;

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/**
 * A SQLite project store over a fresh migrated database, with the writer lock held for the test. The
 * hooks insert the history rows directly: a Work order, an event of its order.
 */
const sqliteUnderTest =
  (locate: () => string): ProjectFactory =>
  async () => {
    const db = openDatabase(locate());
    migrate(db, MIGRATIONS_DIR);
    const store = openSqliteEventStore(db);
    const writer = acquireWriter(mkdtempSync(join(dir, 'writer-')));
    let todo = 0;
    return {
      store: sqliteProjectStore(db, writer, store.gate),
      seedOrder: async (projectId, status) => {
        todo += 1;
        db.run(
          `INSERT INTO orders (order_id, project_id, todo_id, title, line, priority, depends_on,
             last_seq, status, holder, next_kind, progressed, resumed, created_at, updated_at)
           VALUES (?, ?, ?, 'a todo', 'factory-default', 'medium', '[]', 1, ?, 'none', 'none', 0, 0, 0, 0)`,
          [`${projectId}:todo-${todo}`, projectId, `todo-${todo}`, status],
        );
      },
      seedEvent: async (projectId) => {
        todo += 1;
        db.run(
          `INSERT INTO events (order_id, seq, at, actor, command_id, schema_version, type, payload)
           VALUES (?, 1, 0, '{"kind":"factory"}', ?, 1, 'order_created', '{}')`,
          [`${projectId}:event-${todo}`, `command-${todo}`],
        );
      },
      close: async () => {
        writer.release();
        db.close();
      },
    };
  };

defineProjectStoreContract(
  { describe, it },
  'SQLite in memory',
  sqliteUnderTest(() => ':memory:'),
);

defineProjectStoreContract(
  { describe, it },
  'SQLite on a file (WAL)',
  sqliteUnderTest(() => {
    counter += 1;
    return join(dir, `projects-${counter}.db`);
  }),
);

describe('sqlite project store writes', () => {
  it('refuses every write once the writer lock is released', async () => {
    const db = openDatabase(':memory:');
    migrate(db, MIGRATIONS_DIR);
    const store = openSqliteEventStore(db);
    const writer = acquireWriter(mkdtempSync(join(dir, 'released-')));
    const projects = sqliteProjectStore(db, writer, store.gate);
    writer.release();

    const record = {
      projectId: projectIdSchema.parse('released'),
      repoUrl: 'https://example.test/released.git',
      baseBranch: 'main',
      maxRunning: 1,
      depPolicy: 'delivered' as const,
    };
    await expect(projects.add(record, 0)).rejects.toThrow();
    await expect(
      projects.set(record.projectId, { maxRunning: 2 }),
    ).rejects.toThrow();
    await expect(projects.remove(record.projectId)).rejects.toThrow();
    expect(await projects.list()).toEqual([]);
    db.close();
  });
});
