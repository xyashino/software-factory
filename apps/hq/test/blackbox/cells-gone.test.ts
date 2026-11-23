import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { LEASE_TTL_MS } from '../../src/config';
import type { Db } from '../../src/db/client';
import { jobs } from '../../src/db/schema/jobs';
import { workOrders } from '../../src/db/schema/orders';
import { asJobId, asOrderId } from '../../src/domain/common/brand';
import { createTestApp, postJson, type TestApp } from '../support/test-app';
import { seedBaseline } from '../support/test-db';
import {
  claimBody,
  factoryHeaders,
  FACTORY_TOKEN,
  seedFactory,
} from '../support/factory-session';

const PROJECT_ID = 'proj-1';
const SECOND_FACTORY_TOKEN = 'sf_factory_second-token';
const CELL_A = 'cell-aaaaaaaa';
const CELL_B = 'cell-bbbbbbbb';
const CELL_IDLE = 'cell-iiiiiiii';

type ClaimBody = {
  code: number;
  job: null | {
    jobId: string;
    orderId: string | null;
    epoch: number;
  };
};

const setup = () => {
  const { app, clock, db } = createTestApp({ safeTokenAuth: true });
  seedBaseline(db);
  seedFactory(db, 'factory-2', SECOND_FACTORY_TOKEN, clock.now());
  return { app, clock, db };
};

const claim = async (
  app: TestApp,
  cellId: string,
  token: string = FACTORY_TOKEN,
  waitMs = 0,
): Promise<ClaimBody> => {
  const response = await postJson(
    app,
    '/api/v1/cells/claims',
    claimBody({ waitMs }, PROJECT_ID),
    factoryHeaders(cellId, token),
  );
  return (await response.json()) as ClaimBody;
};

const goneCell = (
  app: TestApp,
  cellId: string,
  token: string = FACTORY_TOKEN,
) =>
  postJson(
    app,
    `/api/v1/factories/cells/${encodeURIComponent(cellId)}/gone`,
    undefined,
    { authorization: `Bearer ${token}` },
  );

const heartbeatJob = (
  app: TestApp,
  cellId: string,
  jobId: string,
  epoch: number,
) =>
  postJson(
    app,
    '/api/v1/cells/heartbeats',
    { jobId, epoch },
    factoryHeaders(cellId),
  );

const heartbeatFactory = (app: TestApp, token: string = FACTORY_TOKEN) =>
  postJson(
    app,
    '/api/v1/factories/heartbeat',
    { projects: [] },
    { authorization: `Bearer ${token}` },
  );

const jobRow = (db: Db, jobId: string) =>
  db
    .select()
    .from(jobs)
    .where(eq(jobs.jobId, asJobId(jobId)))
    .get();

const orderState = (db: Db, orderId: string) =>
  db
    .select()
    .from(workOrders)
    .where(eq(workOrders.orderId, asOrderId(orderId)))
    .get();

describe('cell gone', () => {
  it('gone cell mid-job re-queues its order for a sibling cell of the same factory', async () => {
    const { app, db } = setup();
    await claim(app, CELL_A);

    const gone = await goneCell(app, CELL_A);
    const takeover = await claim(app, CELL_B);

    expect(gone.status).toBe(200);
    expect(orderState(db, 'order-1')).toMatchObject({
      state: 'running',
      activeCellId: CELL_B,
      pinnedFactoryId: 'factory-1',
      epoch: 3,
    });
    expect(takeover.job).toMatchObject({ orderId: 'order-1', epoch: 3 });
  });

  it('gone cell leaves its order queued and still pinned to its own factory', async () => {
    const { app, db } = setup();
    await claim(app, CELL_A);

    await goneCell(app, CELL_A);

    expect(orderState(db, 'order-1')).toMatchObject({
      state: 'queued',
      activeCellId: null,
      activeJobId: null,
      pinnedFactoryId: 'factory-1',
      epoch: 2,
    });
  });

  it('gone cell keeps its lost job under the cell id that ran it', async () => {
    const { app, db } = setup();
    const lost = await claim(app, CELL_A);

    await goneCell(app, CELL_A);

    expect(jobRow(db, lost.job?.jobId ?? '')).toMatchObject({
      status: 'lost',
      claimedByCellId: CELL_A,
      claimedByFactoryId: 'factory-1',
    });
  });

  it('gone twice is safe', async () => {
    const { app } = setup();
    await claim(app, CELL_A);

    const first = await goneCell(app, CELL_A);
    const second = await goneCell(app, CELL_A);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
  });

  it('gone for an unknown cell answers 200', async () => {
    const { app } = setup();

    const response = await goneCell(app, 'cell-neverseen');

    expect(response.status).toBe(200);
  });

  it('another factory cannot lose a job it does not own', async () => {
    const { app, db } = setup();
    const lost = await claim(app, CELL_A);

    const response = await goneCell(app, CELL_A, SECOND_FACTORY_TOKEN);

    expect(response.status).toBe(200);
    expect(jobRow(db, lost.job?.jobId ?? '')?.status).toBe('claimed');
  });

  it('gone does not count as a worktree reset', async () => {
    const { app, db } = setup();
    await claim(app, CELL_A);
    const resetsBefore = orderState(db, 'order-1')?.worktreeResets;

    await goneCell(app, CELL_A);

    expect(orderState(db, 'order-1')?.worktreeResets).toBe(resetsBefore);
  });

  it('gone cell cannot send a late result with its old epoch', async () => {
    const { app } = setup();
    const lost = await claim(app, CELL_A);
    await goneCell(app, CELL_A);
    await claim(app, CELL_B);

    const late = await heartbeatJob(
      app,
      CELL_A,
      lost.job?.jobId ?? '',
      lost.job?.epoch ?? -1,
    );

    expect(late.status).toBe(409);
  });

  it('expired lease hands the order to a sibling cell and fences the old one', async () => {
    const { app, clock, db } = setup();
    const lost = await claim(app, CELL_A);
    clock.advance(LEASE_TTL_MS - 1_000);
    await claim(app, CELL_A);
    clock.advance(2_000);

    const takeover = await claim(app, CELL_B);
    const late = await heartbeatJob(
      app,
      CELL_A,
      lost.job?.jobId ?? '',
      lost.job?.epoch ?? -1,
    );

    expect(takeover.job).toMatchObject({ orderId: 'order-1' });
    expect(orderState(db, 'order-1')).toMatchObject({
      state: 'running',
      pinnedFactoryId: 'factory-1',
    });
    expect(late.status).toBe(409);
  });

  it('silent factory unpins its orders and requeues its jobs at the lease expiry', async () => {
    const { app, clock, db } = setup();
    const lost = await claim(app, CELL_IDLE);
    clock.advance(LEASE_TTL_MS + 1_000);

    const takeover = await claim(app, CELL_B, SECOND_FACTORY_TOKEN);

    expect(jobRow(db, lost.job?.jobId ?? '')?.status).toBe('lost');
    expect(takeover.job).toMatchObject({ orderId: 'order-1', epoch: 3 });
    expect(orderState(db, 'order-1')).toMatchObject({
      pinnedFactoryId: 'factory-2',
      activeCellId: CELL_B,
    });
  });

  it('live factory keeps its job while it keeps heartbeating', async () => {
    const { app, clock, db } = setup();
    const held = await claim(app, CELL_IDLE);
    clock.advance(LEASE_TTL_MS / 2);
    await heartbeatJob(app, CELL_IDLE, held.job?.jobId ?? '', 1);
    await heartbeatFactory(app);
    clock.advance(LEASE_TTL_MS / 2 + 1_000);

    const other = await claim(app, CELL_B, SECOND_FACTORY_TOKEN);

    expect(other.job).toMatchObject({ orderId: 'order-2' });
    expect(jobRow(db, held.job?.jobId ?? '')?.status).toBe('claimed');
    expect(orderState(db, 'order-1')).toMatchObject({
      pinnedFactoryId: 'factory-1',
      activeCellId: CELL_IDLE,
    });
  });
});
