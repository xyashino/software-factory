import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Job } from '@repo/factory-core/contracts/job';
import type { CellId, OrderId, ProjectId } from '@repo/factory-core/ids';
import type { StoredEvent } from '@repo/factory-core/order/events';
import { seedProject } from '@repo/factory-runtime/seed';
import { socketFactoryClient } from '../../socket/client';
import { createFakeCell } from './fake-cell';
import { createFixtureRepo, todoFile } from './fixture-repo';

/** The server entry point, run as a real process on its own data directory. */
const MAIN = fileURLToPath(new URL('../../main.ts', import.meta.url));

const PROJECT = 'software-factory' as ProjectId;
const CELL = '01J0000000000000000000000W' as CellId;
const SOCKET = 'factory.sock';

let root: string;
let dataDir: string;
const children: Bun.Subprocess[] = [];

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'factory-sigkill-'));
  dataDir = join(root, 'data');
  mkdirSync(dataDir);
  const repo = await createFixtureRepo(join(root, 'repo'), {
    'add-login': todoFile({ title: 'Add login', v2: true }),
  });
  seedProject(dataDir, { projectId: PROJECT, repoUrl: repo });
});

afterEach(async () => {
  for (const child of children.splice(0)) {
    child.kill('SIGKILL');
    await child.exited;
  }
  rmSync(root, { recursive: true, force: true });
});

const socketPath = (): string => join(dataDir, SOCKET);

/** Starts `factory-server` as a real process and returns once its socket answers a request. */
const startServer = async () => {
  const child = Bun.spawn(['bun', MAIN], {
    env: { ...process.env, FACTORY_DATA_DIR: dataDir },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  children.push(child);
  const client = socketFactoryClient({ socketPath: socketPath() });
  for (let waited = 0; waited < 15_000; waited += 100) {
    try {
      await client.call('board', {});
      return { child, client };
    } catch {
      await Bun.sleep(100);
    }
  }
  throw new Error('factory-server did not answer on its socket');
};

/** Every event of one Work order, in order, read through the socket. */
const traveler = async (
  client: ReturnType<typeof socketFactoryClient>,
  orderId: OrderId,
): Promise<StoredEvent[]> =>
  (await client.call('orderDetail', { orderId })).events;

describe('restart mid-order with SIGKILL', () => {
  it('loses no event when the server is killed mid-build and restarted', async () => {
    const first = await startServer();
    await first.client.call('intakeSync', {});
    const cell = createFakeCell(first.client, CELL, PROJECT);
    await cell.hello();
    let job: Job | null = await cell.claim(0);
    if (!job) throw new Error('expected the plan job');
    job = await cell.run(job); // plan
    job = job ? await cell.run(job) : null; // plan-review; the next job is build
    if (!job) throw new Error('expected the build job');
    expect(job.station?.stationId).toBe('build');
    const orderId = job.orderId;

    first.child.kill('SIGKILL');
    await first.child.exited;

    const second = await startServer();
    const resumed = createFakeCell(second.client, CELL, PROJECT);
    const stations: string[] = [];
    let next: Job | null = job;
    while (next) {
      stations.push(next.station?.stationId ?? next.kind);
      next = await resumed.run(next);
    }

    expect(stations).toEqual(['build', 'quality-gate', 'audit', 'deliver']);
    const [row] = (await second.client.call('board', {})).orders;
    expect(row?.status).toBe('delivered');
    const events = await traveler(second.client, orderId);
    expect(events.map((stored) => stored.seq)).toEqual(
      events.map((_stored, index) => index + 1),
    );
  });
});
