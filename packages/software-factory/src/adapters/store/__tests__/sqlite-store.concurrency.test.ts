import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeClock } from '../../../testing/fake-clock';
import { systemClock } from '../../clock/system-clock';
import { SqliteStore } from '../sqlite-store';

const WRITER = fileURLToPath(new URL('./writer.fixture.ts', import.meta.url));

const runWriter = (
  dbPath: string,
  taskId: string,
  count: number,
): Promise<number | null> => {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [WRITER, dbPath, taskId, String(count)],
      {
        stdio: ['ignore', 'ignore', 'pipe'],
      },
    );
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve(code);
      } else {
        reject(new Error(`writer exited with ${code}: ${stderr}`));
      }
    });
  });
};

describe('sqlite store under concurrent writers', () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'factory-concurrency-'));
    dbPath = join(dir, 'software-factory.db');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('keeps every event when a second process writes to the same database at the same time', async () => {
    const store = new SqliteStore({ path: dbPath, clock: systemClock });
    store.createTask({
      taskId: 'task-c',
      workflow: 'feature',
      todoPath: 'a.md',
      branch: 'b',
    });

    const child = runWriter(dbPath, 'task-c', 400);
    for (let index = 0; index < 400; index += 1) {
      store.append('task-c', {
        type: 'note',
        attemptId: 'parent-1',
        to: 'parent',
        text: `parent ${index}`,
      });
    }
    await child;

    const events = store.events('task-c');
    expect(events).toHaveLength(800);
    expect(new Set(events.map((stored) => stored.seq)).size).toBe(800);
    expect(
      events.filter((stored) => stored.event.type === 'note'),
    ).toHaveLength(800);
    store.close();
  });

  it('opens with WAL, a 5 second busy timeout and foreign keys enforced', () => {
    const store = new SqliteStore({ path: dbPath, clock: new FakeClock(0) });
    expect(store.connectionSettings()).toEqual({
      journalMode: 'wal',
      busyTimeout: 5000,
      foreignKeys: true,
    });
    store.close();
  });
});
