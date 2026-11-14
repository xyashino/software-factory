import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Job } from '@repo/factory-core/contracts/job';
import type { CellId, OrderId, ProjectId } from '@repo/factory-core/ids';
import type { StoredEvent } from '@repo/factory-core/order/events';
import { fakePrState } from '@repo/factory-core/testing';
import {
  openRuntime,
  WriterHeldError,
  type OpenedRuntime,
} from '@repo/factory-runtime/open-runtime';
import { seedProject } from '@repo/factory-runtime/seed';
import { gitMirror } from '../../adapters/git-mirror';
import { socketFactoryClient } from '../../socket/client';
import {
  startSocketListener,
  type SocketListener,
} from '../../socket/listener';
import { createFakeCell, FAKE_PR_URL } from './fake-cell';
import { createFixtureRepo, todoFile } from './fixture-repo';

const PROJECT = 'software-factory' as ProjectId;
const CELL = '01J0000000000000000000000W' as CellId;
const SOCKET = 'factory.sock';

/** The Stations of the `feature` Line, in order, then the delivery (ROADMAP M4 e2e). */
const FEATURE_STATIONS = [
  'plan',
  'plan-review',
  'build',
  'quality-gate',
  'audit',
  'deliver',
];

let root: string;
let dataDir: string;
let repo: string;
let opened: OpenedRuntime | undefined;
let listener: SocketListener | undefined;
const prState = fakePrState();

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'factory-e2e-'));
  dataDir = join(root, 'data');
  mkdirSync(dataDir);
  repo = await createFixtureRepo(join(root, 'repo'), {
    'add-login': todoFile({ title: 'Add login', v2: true }),
  });
  seedProject(dataDir, { projectId: PROJECT, repoUrl: repo });
});

afterEach(async () => {
  await listener?.stop();
  listener = undefined;
  opened?.close();
  opened = undefined;
  rmSync(root, { recursive: true, force: true });
});

/** Opens the data directory and serves it on its socket, the way factory-server does. */
const serve = async (config: Record<string, number> = {}) => {
  opened = openRuntime({
    dataDir,
    git: gitMirror({ mirrorsDir: join(dataDir, 'mirrors') }),
    prState,
    config: { intakePollMs: 0, prPollMs: 0, ...config },
  });
  await opened.runtime.start();
  const socketPath = join(dataDir, SOCKET);
  listener = startSocketListener({ runtime: opened.runtime, socketPath });
  return { socketPath, client: socketFactoryClient({ socketPath }) };
};

/** The Station a job runs, or its kind for the delivery, which has no Station. */
const stationOrKind = (job: Job): string => job.station?.stationId ?? job.kind;

/** Every event of one Work order, in order, read through the socket. */
const traveler = async (
  client: ReturnType<typeof socketFactoryClient>,
  orderId: OrderId,
): Promise<StoredEvent[]> =>
  (await client.call('orderDetail', { orderId })).events;

describe('local flow over the socket', () => {
  it('takes a v2 todo file to delivered, with no network listener', async () => {
    const { client } = await serve();
    const [report] = (await client.call('intakeSync', {})).projects;
    expect(report?.created).toEqual(['add-login']);

    const cell = createFakeCell(client, CELL, PROJECT);
    const ran = await cell.drain();

    expect(ran.map(stationOrKind)).toEqual(FEATURE_STATIONS);
    const [row] = (await client.call('board', {})).orders;
    expect(row?.status).toBe('delivered');
    expect(row?.prUrl).toBe(FAKE_PR_URL);

    prState.set(FAKE_PR_URL, 'merged');
    await opened!.runtime.pollPrStates();
    const [merged] = (await client.call('board', {})).orders;
    expect(merged?.prState).toBe('merged');
  });

  it('streams the Work order over the feed, from the first event', async () => {
    const { client } = await serve();
    await client.call('intakeSync', {});
    await createFakeCell(client, CELL, PROJECT).drain();
    prState.set(FAKE_PR_URL, 'merged');
    await opened!.runtime.pollPrStates();

    const abort = new AbortController();
    const seen: string[] = [];
    for await (const stored of client.stream(0, abort.signal)) {
      seen.push(stored.event.type);
      if (stored.event.type === 'pr_state_changed') abort.abort();
    }

    expect(seen[0]).toBe('order_created');
    expect(seen).toContain('delivery_finished');
    expect(seen.at(-1)).toBe('pr_state_changed');
  });

  it('refuses a second writer on the same data directory', async () => {
    await serve();

    expect(() => openRuntime({ dataDir })).toThrow(WriterHeldError);
  });
});

describe('restart mid-order', () => {
  it('finishes the Work order after the server stops and starts again', async () => {
    const config = { leaseTtlMs: 300, reaperMs: 50 };
    const first = await serve(config);
    await first.client.call('intakeSync', {});
    const cell = createFakeCell(first.client, CELL, PROJECT);
    await cell.hello();
    let job = await cell.claim(0);
    if (!job) throw new Error('expected the plan job');
    job = await cell.run(job); // plan
    job = job ? await cell.run(job) : null; // plan-review; the next job is build
    expect(job?.station?.stationId).toBe('build');

    // The server stops while the build job is claimed and not yet run.
    await listener?.stop();
    listener = undefined;
    opened?.close();
    opened = undefined;

    const second = await serve(config);
    const resumed = await createFakeCell(second.client, CELL, PROJECT).drain(
      3_000,
    );

    expect(
      resumed.map((item) => item.station?.stationId ?? item.kind),
    ).toContain('build');
    const [row] = (await second.client.call('board', {})).orders;
    expect(row?.status).toBe('delivered');
  });

  it('keeps every event contiguous when the job was lost in the restart', async () => {
    const config = { leaseTtlMs: 300, reaperMs: 50 };
    const first = await serve(config);
    await first.client.call('intakeSync', {});
    const cell = createFakeCell(first.client, CELL, PROJECT);
    await cell.hello();
    let job = await cell.claim(0);
    if (!job) throw new Error('expected the plan job');
    job = await cell.run(job);
    job = job ? await cell.run(job) : null;
    const orderId = job?.orderId;
    if (!orderId) throw new Error('expected a claimed build job');
    await listener?.stop();
    listener = undefined;
    opened?.close();
    opened = undefined;

    const second = await serve(config);
    await createFakeCell(second.client, CELL, PROJECT).drain(3_000);
    const events = await traveler(second.client, orderId);

    expect(events.map((stored) => stored.seq)).toEqual(
      events.map((_stored, index) => index + 1),
    );
    expect(events.map((stored) => stored.event.type)).toContain('job_lost');
  });
});
