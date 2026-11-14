import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Job } from '@repo/factory-core/contracts/job';
import { WireFailure } from '@repo/factory-core/contracts/errors';
import type { CellId, OrderId, ProjectId } from '@repo/factory-core/ids';
import { fakePrState } from '@repo/factory-core/testing';
import {
  openRuntime,
  type OpenedRuntime,
} from '@repo/factory-runtime/open-runtime';
import { seedProject } from '@repo/factory-runtime/seed';
import { gitMirror } from '../../adapters/git-mirror';
import { socketFactoryClient } from '../../socket/client';
import { startSocketListener } from '../../socket/listener';
import { startHttpListener, type HttpListener } from '../../http/listener';
import { createFakeCell, FAKE_COMMIT, FAKE_PR_URL } from './fake-cell';
import { httpFactoryClient } from './http-client';
import { createFixtureRepo, todoFile } from './fixture-repo';

const PROJECT = 'software-factory' as ProjectId;
const ORDER = 'software-factory:add-login' as OrderId;
const LOCAL_CELL = '01J0000000000000000000000W' as CellId;
const SOCKET = 'factory.sock';

/** The Stations of the `feature` Line, in order, then the delivery (the v2-10 scenario). */
const FEATURE_STATIONS = [
  'plan',
  'plan-review',
  'build',
  'quality-gate',
  'audit',
  'deliver',
];

const roots: string[] = [];
const listeners: { stop(): Promise<void> }[] = [];
const openedRuntimes: OpenedRuntime[] = [];

afterEach(async () => {
  for (const listener of listeners.splice(0)) await listener.stop();
  for (const opened of openedRuntimes.splice(0)) opened.close();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

/** A fresh data directory seeded with the fixture repository and its one todo file. */
const freshFactory = async () => {
  const root = mkdtempSync(join(tmpdir(), 'factory-remote-e2e-'));
  roots.push(root);
  const dataDir = join(root, 'data');
  mkdirSync(dataDir);
  const repo = await createFixtureRepo(join(root, 'repo'), {
    'add-login': todoFile({ title: 'Add login', v2: true }),
  });
  seedProject(dataDir, { projectId: PROJECT, repoUrl: repo });
  return { dataDir, prState: fakePrState() };
};

const openFactory = (
  dataDir: string,
  prState: ReturnType<typeof fakePrState>,
) => {
  const opened = openRuntime({
    dataDir,
    git: gitMirror({ mirrorsDir: join(dataDir, 'mirrors') }),
    prState,
    config: { intakePollMs: 0, prPollMs: 0 },
  });
  openedRuntimes.push(opened);
  return opened;
};

interface BoardRow {
  title: string;
  line: string;
  priority: string;
  status: string;
  prUrl: string | null;
  prState: string | null;
}

/** The Traveler's event types and the board row's projection fields, for comparison. */
const projectionOf = async (
  board: () => Promise<{ orders: BoardRow[] }>,
  traveler: () => Promise<{ event: { type: string } }[]>,
) => {
  const [row] = (await board()).orders;
  return {
    eventTypes: (await traveler()).map((stored) => stored.event.type),
    row: row && {
      title: row.title,
      line: row.line,
      priority: row.priority,
      status: row.status,
      prUrl: row.prUrl,
      prState: row.prState,
    },
  };
};

/** Runs the v2-10 scenario through the socket, the local transport. Returns what it produced. */
const runLocal = async () => {
  const { dataDir, prState } = await freshFactory();
  const opened = openFactory(dataDir, prState);
  await opened.runtime.start();
  const socketPath = join(dataDir, SOCKET);
  listeners.push(startSocketListener({ runtime: opened.runtime, socketPath }));
  const client = socketFactoryClient({ socketPath });

  await client.call('intakeSync', {});
  const ran = await createFakeCell(client, LOCAL_CELL, PROJECT).drain();
  prState.set(FAKE_PR_URL, 'merged');
  await opened.runtime.pollPrStates();
  const projection = await projectionOf(
    () => client.call('board', {}),
    async () => (await client.call('orderDetail', { orderId: ORDER })).events,
  );
  return {
    stations: ran.map((job) => job.station?.stationId ?? job.kind),
    ...projection,
  };
};

/** Joins a Cell over HTTP with a join token, the way a Cell does on its first start. */
const joinOverHttp = async (
  opened: OpenedRuntime,
  baseUrl: string,
): Promise<{ cellId: CellId; credential: string }> => {
  const created = await opened.runtime.call('joinTokenCreate', {
    commandId: `join-${Math.random()}`,
    name: 'pool',
  });
  const response = await fetch(`${baseUrl}/v1/cell/join`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ joinToken: created.token, name: 'cell-remote' }),
  });
  if (response.status !== 200)
    throw new Error(`join answered ${response.status}`);
  return (await response.json()) as { cellId: CellId; credential: string };
};

/** A remote factory on a TCP port: the same runtime, a supervisor client and a Cell client. */
const serveRemote = async (
  dataDir: string,
  prState: ReturnType<typeof fakePrState>,
) => {
  const opened = openFactory(dataDir, prState);
  await opened.runtime.start();
  const listener: HttpListener = startHttpListener({
    runtime: opened.runtime,
    hostname: '127.0.0.1',
    port: 0,
  });
  listeners.push(listener);
  const supervisor = await opened.runtime.remote.createSupervisorToken('dev');
  const admin = httpFactoryClient({
    baseUrl: listener.url,
    token: supervisor.token,
  });
  const joined = await joinOverHttp(opened, listener.url);
  const cell = httpFactoryClient({
    baseUrl: listener.url,
    token: joined.credential,
  });
  return { opened, listener, admin, cell, cellId: joined.cellId };
};

/** Runs the same scenario through TCP HTTP with a fake Cell that talks only over HTTP. */
const runRemote = async () => {
  const { dataDir, prState } = await freshFactory();
  const remote = await serveRemote(dataDir, prState);

  await remote.admin.call('intakeSync', {});
  const ran = await createFakeCell(remote.cell, remote.cellId, PROJECT).drain();
  prState.set(FAKE_PR_URL, 'merged');
  await remote.opened.runtime.pollPrStates();
  const projection = await projectionOf(
    () => remote.admin.call('board', {}),
    async () =>
      (await remote.admin.call('orderDetail', { orderId: ORDER })).events,
  );
  return {
    stations: ran.map((job) => job.station?.stationId ?? job.kind),
    ...projection,
  };
};

describe('remote flow over HTTP', () => {
  it('ends with the same stations, events and projections as the local socket run', async () => {
    const local = await runLocal();
    const remote = await runRemote();

    expect(remote.stations).toEqual(FEATURE_STATIONS);
    expect(remote.stations).toEqual(local.stations);
    expect(remote.eventTypes).toEqual(local.eventTypes);
    expect(remote.row).toEqual(local.row);
    expect(remote.row?.status).toBe('merged');
    expect(remote.row?.prState).toBe('merged');
    expect(remote.row?.prUrl).toBe(FAKE_PR_URL);
  });

  it('streams the Work order over SSE, from the first event', async () => {
    const { dataDir, prState } = await freshFactory();
    const remote = await serveRemote(dataDir, prState);
    await remote.admin.call('intakeSync', {});
    await createFakeCell(remote.cell, remote.cellId, PROJECT).drain();
    prState.set(FAKE_PR_URL, 'merged');
    await remote.opened.runtime.pollPrStates();

    const abort = new AbortController();
    const seen: string[] = [];
    for await (const stored of remote.admin.stream(0, abort.signal)) {
      seen.push(stored.event.type);
      if (stored.event.type === 'pr_state_changed') abort.abort();
    }

    expect(seen[0]).toBe('order_created');
    expect(seen).toContain('delivery_finished');
    expect(seen.at(-1)).toBe('pr_state_changed');
  });

  it('refuses a claimed job whose epoch is stale with 409 stale_epoch', async () => {
    const { dataDir, prState } = await freshFactory();
    const remote = await serveRemote(dataDir, prState);
    await remote.admin.call('intakeSync', {});
    const cell = createFakeCell(remote.cell, remote.cellId, PROJECT);
    await cell.hello();
    const job = await cell.claim(0);
    if (!job) throw new Error('expected the plan job');

    const refused = remote.cell.call('submitCommand', {
      cellId: remote.cellId,
      orderId: job.orderId,
      jobId: job.jobId,
      commandId: `${job.jobId}:stale`,
      epoch: job.epoch + 1,
      command: { type: 'StartCycle', baseCommit: FAKE_COMMIT },
    });

    await expect(refused).rejects.toMatchObject({
      status: 409,
      error: { code: 'stale_epoch' },
    });
  });

  it('replays a duplicate commandId with the stored answer, next included', async () => {
    const { dataDir, prState } = await freshFactory();
    const remote = await serveRemote(dataDir, prState);
    await remote.admin.call('intakeSync', {});
    const cell = createFakeCell(remote.cell, remote.cellId, PROJECT);
    await cell.hello();
    const job: Job | null = await cell.claim(0);
    if (!job) throw new Error('expected the plan job');
    const send = () =>
      remote.cell.call('submitCommand', {
        cellId: remote.cellId,
        orderId: job.orderId,
        jobId: job.jobId,
        commandId: `${job.jobId}:start`,
        epoch: job.epoch,
        command: { type: 'StartCycle', baseCommit: FAKE_COMMIT },
      });

    const first = await send();
    const replay = await send();

    expect(first.events.length).toBeGreaterThan(0);
    expect(replay).toEqual(first);
    expect(replay).toHaveProperty('next');
  });

  it('refuses a credential that was never issued with 401 unauthorized', async () => {
    const { dataDir, prState } = await freshFactory();
    const remote = await serveRemote(dataDir, prState);
    const stranger = httpFactoryClient({
      baseUrl: remote.listener.url,
      token: 'a-credential-that-was-never-issued-here',
    });

    const refused = stranger.call('claim', {
      cellId: remote.cellId,
      waitMs: 0,
    });

    await expect(refused).rejects.toBeInstanceOf(WireFailure);
    await expect(refused).rejects.toMatchObject({
      status: 401,
      error: { code: 'unauthorized' },
    });
  });
});
