import { Database } from 'bun:sqlite';
import {
  copyFileSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeClock } from '../../../testing/fake-clock';
import {
  defineStoreContract,
  type StoreHarness,
} from '../../../testing/store.contract';
import { EventPayloadError, SqliteStore } from '../sqlite-store';

const REAL_MIGRATIONS = fileURLToPath(
  new URL('../../../../migrations', import.meta.url),
);

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'factory-store-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

defineStoreContract('sqlite', () => {
  const clock = new FakeClock(0);
  const store = new SqliteStore({
    path: join(dir, 'software-factory.db'),
    clock,
  });
  const harness: StoreHarness = {
    store,
    clock,
    dispose: () => store.close(),
  };
  return harness;
});

describe('sqlite store', () => {
  it('applies new migrations on reopen and keeps existing events', () => {
    const migrations = join(dir, 'migrations');
    mkdirSync(migrations);
    copyFileSync(
      join(REAL_MIGRATIONS, '0001_init.sql'),
      join(migrations, '0001_init.sql'),
    );
    const path = join(dir, 'db.sqlite');

    const first = new SqliteStore({
      path,
      clock: new FakeClock(0),
      migrationsDir: migrations,
    });
    first.createTask({
      taskId: 't',
      workflow: 'feature',
      todoPath: 'a.md',
      branch: 'b',
    });
    first.append('t', { type: 'setup_started' });
    first.close();

    writeFileSync(
      join(migrations, '0002_add_note.sql'),
      'ALTER TABLE tasks ADD COLUMN note TEXT;',
    );
    const second = new SqliteStore({
      path,
      clock: new FakeClock(0),
      migrationsDir: migrations,
    });
    expect(second.events('t')).toHaveLength(1);
    second.close();

    const raw = new Database(path);
    const versions = raw
      .query<{ version: number }, []>(
        'SELECT version FROM schema_migrations ORDER BY version',
      )
      .all()
      .map((row) => row.version);
    raw.close();
    expect(versions).toEqual([1, 2]);
  });

  it('names the sequence number when a stored payload no longer matches its schema', () => {
    const path = join(dir, 'corrupt.db');
    const store = new SqliteStore({ path, clock: new FakeClock(0) });
    store.createTask({
      taskId: 't',
      workflow: 'feature',
      todoPath: 'a.md',
      branch: 'b',
    });
    store.close();

    const raw = new Database(path);
    raw
      .query(
        `INSERT INTO events (task_id, attempt_id, type, payload, at)
         VALUES ('t', NULL, 'setup_finished', '{"type":"setup_finished","ok":"yes","log":""}', 0)`,
      )
      .run();
    raw.close();

    const reopened = new SqliteStore({ path, clock: new FakeClock(0) });
    let caught: unknown;
    try {
      reopened.events('t');
    } catch (error) {
      caught = error;
    }
    reopened.close();

    expect(caught).toBeInstanceOf(EventPayloadError);
    if (caught instanceof EventPayloadError) {
      expect(caught.seq).toBe(1);
    }
  });

  it('keeps the database file readable as WAL on disk', () => {
    const path = join(dir, 'wal.db');
    const store = new SqliteStore({ path, clock: new FakeClock(0) });
    store.createTask({
      taskId: 't',
      workflow: 'feature',
      todoPath: 'a.md',
      branch: 'b',
    });
    store.close();
    expect(readFileSync(path).subarray(18, 19)[0]).toBe(2);
  });
});
