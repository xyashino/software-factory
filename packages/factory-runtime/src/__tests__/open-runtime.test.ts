import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { WorkerId } from '@repo/factory-core/ids';
import { MIGRATIONS_DIR, migrate } from '@repo/factory-db/migrate';
import { openDatabase } from '@repo/factory-db/sqlite-event-store';
import { WriterHeldError } from '@repo/factory-db/writer-lock';
import {
  DATABASE_FILE_NAME,
  openRuntime,
  type OpenedRuntime,
} from '../open-runtime';
import { createOrder, helloWorker, PROJECT, REPO } from './test-kit';

const WORKER = '01J0000000000000000000000W' as WorkerId;

let dataDir: string;
const opened: OpenedRuntime[] = [];

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'factory-runtime-'));
  // The project row a Work order belongs to; the Factory registers projects, the tests stand in.
  const db = openDatabase(join(dataDir, DATABASE_FILE_NAME));
  migrate(db, MIGRATIONS_DIR);
  db.run(
    'INSERT INTO projects (project_id, repo_url, created_at) VALUES (?, ?, ?)',
    [PROJECT, REPO, 0],
  );
  db.close();
});

afterEach(() => {
  for (const runtime of opened.splice(0)) runtime.close();
  rmSync(dataDir, { recursive: true, force: true });
});

const open = (): OpenedRuntime => {
  const runtime = openRuntime({ dataDir });
  opened.push(runtime);
  return runtime;
};

describe('openRuntime', () => {
  it('refuses a second runtime on the same data directory while the first holds it', () => {
    open();

    expect(() => openRuntime({ dataDir })).toThrow(WriterHeldError);
  });

  it('lets the directory be opened again after the holder closes', () => {
    const first = open();
    first.close();
    opened.pop();

    const second = open();

    expect(second.writer.held).toBe(true);
  });

  it('keeps orders, the Worker registry and claims across a restart', async () => {
    const first = open();
    await helloWorker(first, WORKER);
    await createOrder(first, { todoId: 'todo-a' });
    const claimed = await first.runtime.call('claim', {
      workerId: WORKER,
      waitMs: 0,
    });
    const job = claimed.job;
    if (!job) throw new Error('expected a job');
    first.close();
    opened.pop();

    const second = open();
    const board = await second.runtime.call('board', {});
    const leases = await second.ports.leases.forWorker(WORKER);
    const prompt = job.station?.promptBlob
      ? await second.ports.blobs.get(job.station.promptBlob)
      : undefined;

    expect(board.orders.map((order) => order.orderId)).toEqual([job.orderId]);
    expect(leases.map((lease) => lease.jobId)).toEqual([job.jobId]);
    expect(prompt?.byteLength).toBeGreaterThan(0);
    expect((await second.ports.workers.get(WORKER))?.info?.runners).toEqual([
      'claude',
      'cursor',
    ]);
  });

  it('serves the same board through the client as through the runtime', async () => {
    const runtime = open();
    await createOrder(runtime, { todoId: 'todo-a' });

    const direct = await runtime.runtime.call('board', {});
    const viaClient = await runtime.runtime.client.call('board', {});

    expect(viaClient).toEqual(direct);
  });
});
