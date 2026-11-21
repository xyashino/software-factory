import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { cells } from '../../src/db/schema/cells';
import { jobs } from '../../src/db/schema/jobs';
import { workOrders } from '../../src/db/schema/orders';
import { safeTokens } from '../../src/db/schema/tokens';
import { stateTransitions } from '../../src/db/schema/transitions';
import {
  hashToken,
  TOKEN_PREFIXES,
} from '../../src/application/tokens/token-hash';
import {
  asCellId,
  asJobId,
  asOrderId,
  asTokenId,
} from '../../src/domain/common/brand';
import type { Db } from '../../src/db/client';
import { createTestApp, postJson, type TestApp } from '../support/test-app';
import { seedBaseline } from '../support/test-db';

const PROJECT_ID = 'proj-1';
const JOIN_TOKEN = 'sf_join_test-join-token';
const SUPERVISOR_TOKEN = 'supervisor-test-token';

type ClaimedJob = {
  jobId: string;
  orderId: string | null;
  workspaceMode: string;
  epoch: number;
};

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

const setup = () => {
  const { app, clock, db } = createTestApp({ safeTokenAuth: true });
  seedBaseline(db);
  db.insert(safeTokens)
    .values({
      tokenId: asTokenId('join-1'),
      tokenHash: hashToken(JOIN_TOKEN),
      prefix: TOKEN_PREFIXES.join,
      kind: 'cell_join',
      name: 'join',
      scopesJson: ['cell:enroll'],
      createdAt: clock.now(),
    })
    .run();
  db.insert(safeTokens)
    .values({
      tokenId: asTokenId('supervisor-1'),
      tokenHash: hashToken(SUPERVISOR_TOKEN),
      prefix: 'sf_sup_',
      kind: 'supervisor',
      name: 'supervisor',
      scopesJson: ['supervisor:read', 'supervisor:write'],
      createdAt: clock.now(),
    })
    .run();
  return { app, db };
};

const enrollCell = async (
  app: TestApp,
  name: string,
): Promise<{ cellId: string; token: string }> => {
  const response = await postJson(
    app,
    '/api/v1/cells/enroll',
    {
      projectId: PROJECT_ID,
      name,
      allowedLines: ['feature'],
      runners: ['claude'],
    },
    bearer(JOIN_TOKEN),
  );
  const body = (await response.json()) as {
    cellId: string;
    sessionToken: string;
  };
  return { cellId: body.cellId, token: body.sessionToken };
};

const claimJob = async (
  app: TestApp,
  token: string,
): Promise<ClaimedJob | null> => {
  const response = await postJson(
    app,
    '/api/v1/cells/claims',
    {},
    bearer(token),
  );
  const body = (await response.json()) as { job: ClaimedJob | null };
  return body.job;
};

const claimedJob = async (app: TestApp, token: string): Promise<ClaimedJob> => {
  const job = await claimJob(app, token);
  if (job === null) throw new Error('expected the cell to claim a job');
  return job;
};

const heartbeat = async (
  app: TestApp,
  token: string,
  job: ClaimedJob,
): Promise<{ status: number; body: { signals?: string[] } }> => {
  const response = await postJson(
    app,
    '/api/v1/cells/heartbeats',
    { jobId: job.jobId, epoch: job.epoch },
    bearer(token),
  );
  return {
    status: response.status,
    body: (await response.json()) as { signals?: string[] },
  };
};

const drainCell = (
  app: TestApp,
  cellId: string,
  body: Record<string, unknown> = {},
): Promise<Response> =>
  postJson(
    app,
    `/api/v1/cells/${cellId}/drain`,
    body,
    bearer(SUPERVISOR_TOKEN),
  );

const leaveCell = (
  app: TestApp,
  token: string,
  body: { commandId: string; epoch: number; jobId?: string },
): Promise<Response> =>
  postJson(app, '/api/v1/cells/leave', body, bearer(token));

const helloCell = (app: TestApp, token: string): Promise<Response> =>
  postJson(
    app,
    '/api/v1/cells/hello',
    {
      projectId: PROJECT_ID,
      allowedLines: ['feature'],
      runners: ['claude'],
      localWorktrees: [],
    },
    bearer(token),
  );

const cellRow = (db: Db, cellId: string) =>
  db
    .select()
    .from(cells)
    .where(eq(cells.cellId, asCellId(cellId)))
    .get();

const jobRow = (db: Db, jobId: string) =>
  db
    .select()
    .from(jobs)
    .where(eq(jobs.jobId, asJobId(jobId)))
    .get();

const orderRow = (db: Db, orderId: string) =>
  db
    .select()
    .from(workOrders)
    .where(eq(workOrders.orderId, asOrderId(orderId)))
    .get();

const transitionCount = (db: Db): number =>
  db.select().from(stateTransitions).all().length;

describe('cell drain', () => {
  it('marks the cell draining and leaves its running job in place', async () => {
    const { app, db } = setup();
    const cell = await enrollCell(app, 'cell-a');
    const job = await claimedJob(app, cell.token);

    const response = await drainCell(app, cell.cellId);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      code: 200,
      status: 'draining',
      force: false,
      offline: false,
    });
    expect(cellRow(db, cell.cellId)).toMatchObject({ status: 'draining' });
    expect(jobRow(db, job.jobId)).toMatchObject({
      status: 'claimed',
      cellId: cell.cellId,
    });
  });

  it('answers a repeated drain with the same state and writes no new rows', async () => {
    const { app, db } = setup();
    const cell = await enrollCell(app, 'cell-a');
    await drainCell(app, cell.cellId, { force: true });
    const rowsBefore = transitionCount(db);

    const response = await drainCell(app, cell.cellId);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: 'draining',
      force: true,
    });
    expect(transitionCount(db)).toBe(rowsBefore);
  });

  it('tells the cell to drain and to force-stop on its next heartbeat', async () => {
    const { app } = setup();
    const cell = await enrollCell(app, 'cell-a');
    const job = await claimedJob(app, cell.token);
    await drainCell(app, cell.cellId, { force: true });

    const { status, body } = await heartbeat(app, cell.token, job);

    expect(status).toBe(200);
    expect(body.signals).toEqual(['drain', 'force']);
  });

  it('tells the cell to drain without force when force is not requested', async () => {
    const { app } = setup();
    const cell = await enrollCell(app, 'cell-a');
    const job = await claimedJob(app, cell.token);
    await drainCell(app, cell.cellId);

    const { body } = await heartbeat(app, cell.token, job);

    expect(body.signals).toEqual(['drain']);
  });

  it('hands a draining cell no new work', async () => {
    const { app, db } = setup();
    const cell = await enrollCell(app, 'cell-a');
    await drainCell(app, cell.cellId);

    const job = await claimJob(app, cell.token);

    expect(job).toBeNull();
    expect(orderRow(db, 'order-1')).toMatchObject({ state: 'queued' });
  });

  it('tells an idle draining cell to drain on its claim reply', async () => {
    const { app } = setup();
    const cell = await enrollCell(app, 'cell-a');
    await drainCell(app, cell.cellId);

    const response = await postJson(
      app,
      '/api/v1/cells/claims',
      {},
      bearer(cell.token),
    );

    expect(await response.json()).toMatchObject({
      code: 200,
      job: null,
      signals: ['drain'],
    });
  });

  it('sends no drain signal on a claim reply for a running cell', async () => {
    const { app } = setup();
    const cell = await enrollCell(app, 'cell-a');

    const response = await postJson(
      app,
      '/api/v1/cells/claims',
      {},
      bearer(cell.token),
    );

    expect(await response.json()).toMatchObject({
      job: expect.any(Object),
      signals: [],
    });
  });

  it('upgrades a pending drain to force when a later drain asks for force', async () => {
    const { app } = setup();
    const cell = await enrollCell(app, 'cell-a');
    const job = await claimedJob(app, cell.token);
    await drainCell(app, cell.cellId);

    const response = await drainCell(app, cell.cellId, { force: true });
    const { body } = await heartbeat(app, cell.token, job);

    expect(await response.json()).toMatchObject({
      status: 'draining',
      force: true,
    });
    expect(body.signals).toEqual(['drain', 'force']);
  });

  it('records the drain on an offline cell and flags it as offline', async () => {
    const { app, db } = setup();
    const cell = await enrollCell(app, 'cell-a');
    db.update(cells)
      .set({ status: 'offline' })
      .where(eq(cells.cellId, asCellId(cell.cellId)))
      .run();

    const response = await drainCell(app, cell.cellId);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: 'draining',
      offline: true,
    });
    expect(cellRow(db, cell.cellId)).toMatchObject({ status: 'draining' });
  });

  it('refuses to drain a cell that does not exist', async () => {
    const { app } = setup();

    const response = await drainCell(app, 'cell-missing');

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      code: 404,
      type: 'not-found',
    });
  });
});

describe('cell leave', () => {
  it('re-queues the held job for reuse, keeps the pin and bumps the epoch', async () => {
    const { app, db } = setup();
    const cell = await enrollCell(app, 'cell-a');
    const job = await claimedJob(app, cell.token);
    expect(job.orderId).toBe('order-1');

    const response = await leaveCell(app, cell.token, {
      commandId: 'leave-1',
      epoch: job.epoch,
      jobId: job.jobId,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ code: 200, status: 'left' });
    expect(jobRow(db, job.jobId)).toMatchObject({
      status: 'ready',
      workspaceMode: 'reuse',
      cellId: null,
      epoch: job.epoch + 1,
    });
    expect(orderRow(db, 'order-1')).toMatchObject({
      state: 'queued',
      activeCellId: null,
      activeJobId: null,
      pinnedCellId: cell.cellId,
      epoch: job.epoch + 1,
    });
    expect(cellRow(db, cell.cellId)).toMatchObject({
      status: 'left',
      activeJobId: null,
    });
  });

  it('lets the same cell resume its warm order after it reconnects', async () => {
    const { app } = setup();
    const cell = await enrollCell(app, 'cell-a');
    const job = await claimedJob(app, cell.token);
    await leaveCell(app, cell.token, {
      commandId: 'leave-1',
      epoch: job.epoch,
      jobId: job.jobId,
    });

    const hello = await helloCell(app, cell.token);
    const resumed = await claimedJob(app, cell.token);

    expect(hello.status).toBe(200);
    expect(resumed).toMatchObject({
      jobId: job.jobId,
      orderId: 'order-1',
      workspaceMode: 'reuse',
      epoch: job.epoch + 2,
    });
  });

  it('refuses a leave whose epoch is stale and changes nothing', async () => {
    const { app, db } = setup();
    const cell = await enrollCell(app, 'cell-a');
    const job = await claimedJob(app, cell.token);
    const rowsBefore = transitionCount(db);

    const response = await leaveCell(app, cell.token, {
      commandId: 'leave-1',
      epoch: job.epoch - 1,
      jobId: job.jobId,
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      type: 'stale-lease-epoch',
    });
    expect(transitionCount(db)).toBe(rowsBefore);
    expect(jobRow(db, job.jobId)).toMatchObject({
      status: 'claimed',
      cellId: cell.cellId,
      epoch: job.epoch,
    });
    expect(cellRow(db, cell.cellId)).toMatchObject({ status: 'busy' });
  });

  it('refuses a leave that does not name the job it holds', async () => {
    const { app, db } = setup();
    const cell = await enrollCell(app, 'cell-a');
    const job = await claimedJob(app, cell.token);

    const response = await leaveCell(app, cell.token, {
      commandId: 'leave-1',
      epoch: job.epoch,
    });

    expect(response.status).toBe(409);
    expect(jobRow(db, job.jobId)).toMatchObject({ status: 'claimed' });
  });

  it('leaves without a job, clears the pin and gives no more work', async () => {
    const { app, db } = setup();
    const cell = await enrollCell(app, 'cell-a');
    db.update(workOrders)
      .set({ pinnedCellId: asCellId(cell.cellId) })
      .where(eq(workOrders.orderId, asOrderId('order-2')))
      .run();

    const response = await leaveCell(app, cell.token, {
      commandId: 'leave-1',
      epoch: 0,
    });

    expect(response.status).toBe(200);
    expect(cellRow(db, cell.cellId)).toMatchObject({ status: 'left' });
    expect(orderRow(db, 'order-2')).toMatchObject({ pinnedCellId: null });
    expect(await claimJob(app, cell.token)).toBeNull();
  });

  it('returns the same reply for a repeated commandId and writes no new rows', async () => {
    const { app, db } = setup();
    const cell = await enrollCell(app, 'cell-a');
    const job = await claimedJob(app, cell.token);
    const body = {
      commandId: 'leave-1',
      epoch: job.epoch,
      jobId: job.jobId,
    };
    await leaveCell(app, cell.token, body);
    const rowsAfterFirst = transitionCount(db);

    const replay = await leaveCell(app, cell.token, body);

    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ code: 200, status: 'left' });
    expect(transitionCount(db)).toBe(rowsAfterFirst);
  });

  it('lets another cell claim an order pinned to a cell that has left', async () => {
    const { app } = setup();
    const cellA = await enrollCell(app, 'cell-a');
    const job = await claimedJob(app, cellA.token);
    await leaveCell(app, cellA.token, {
      commandId: 'leave-1',
      epoch: job.epoch,
      jobId: job.jobId,
    });
    const cellB = await enrollCell(app, 'cell-b');

    const next = await claimedJob(app, cellB.token);

    expect(next.orderId).toBe('order-1');
  });
});
