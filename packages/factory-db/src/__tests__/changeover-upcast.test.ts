import { describe, expect, it } from 'vitest';
import {
  orderIdOf,
  projectIdSchema,
  todoIdSchema,
} from '@repo/factory-core/ids';
import { openSeededStore } from './helpers';

const ORDER = orderIdOf(
  projectIdSchema.parse('software-factory'),
  todoIdSchema.parse('legacy-1'),
);
const JOB = '01J0000000000000000000000J';
const BLOB = `sha256:${'b'.repeat(64)}`;

/** One raw order row, as a store at `schemaVersion` wrote it. */
const insertRow = (
  db: ReturnType<typeof openSeededStore>['db'],
  seq: number,
  schemaVersion: number,
  stage: string,
): void => {
  db.run(
    'INSERT INTO events (order_id, seq, at, actor, command_id, epoch, schema_version, type, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      ORDER,
      seq,
      1000 + seq,
      JSON.stringify({ kind: 'factory' }),
      `cmd-${seq}`,
      null,
      schemaVersion,
      'workspace_failed',
      JSON.stringify({
        type: 'workspace_failed',
        jobId: JOB,
        stage,
        detail: 'exited 3',
        logBlob: BLOB,
      }),
    ],
  );
};

describe('stored order rows across the workspace stage rename', () => {
  it('reads a version 2 row that names stage setup as a version 3 changeover failure', async () => {
    const { db, store } = openSeededStore();
    insertRow(db, 1, 2, 'setup');

    const [stored] = await store.load(ORDER);

    expect(stored?.schemaVersion).toBe(3);
    expect(stored?.event).toMatchObject({
      type: 'workspace_failed',
      stage: 'changeover',
    });
  });

  it('reads a version 3 row as it was written, next to a version 2 row', async () => {
    const { db, store } = openSeededStore();
    insertRow(db, 1, 2, 'setup');
    insertRow(db, 2, 3, 'changeover');

    const stored = await store.load(ORDER);

    expect(stored.map((event) => event.schemaVersion)).toEqual([3, 3]);
    expect(stored.map((event) => event.event)).toMatchObject([
      { stage: 'changeover' },
      { stage: 'changeover' },
    ]);
  });

  it('refuses a version 3 row that still names the retired stage setup', async () => {
    const { db, store } = openSeededStore();
    insertRow(db, 1, 3, 'setup');

    await expect(store.load(ORDER)).rejects.toThrow(/unreadable/);
  });
});
