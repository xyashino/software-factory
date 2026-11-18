import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { cells } from '../../src/db/schema/cells';
import { incidents } from '../../src/db/schema/incidents';
import { workOrders } from '../../src/db/schema/orders';
import { safeTokens } from '../../src/db/schema/tokens';
import {
  hashToken,
  TOKEN_PREFIXES,
} from '../../src/application/tokens/token-hash';
import { asOrderId, asTokenId } from '../../src/domain/common/brand';
import type { Db } from '../../src/db/client';
import {
  createTestApp,
  getJson,
  postJson,
  type TestApp,
} from '../support/test-app';
import { seedBaseline } from '../support/test-db';

const PROJECT_ID = 'proj-1';
const JOIN_TOKEN = 'sf_join_test-join-token';
const SUPERVISOR_TOKEN = 'supervisor-test-token';
const FIRST_ORDER_ID = 'order-1';
const SECOND_ORDER_ID = 'order-2';

type ErrorBody = { code: number; type: string };

type ClaimedJob = { jobId: string; orderId: string; epoch: number };

type TransitionBody = {
  code: number;
  action?: string;
  markedLineUnavailable?: boolean;
  nextJob?: null | ClaimedJob;
};

type CellsBody = {
  cells: { name: string; activeJobId: string | null }[];
};

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

const setup = () => {
  const { app, clock, db } = createTestApp({ safeTokenAuth: true });
  seedBaseline(db);
  db.update(cells).set({ status: 'offline' }).run();
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

const enrollCell = async (app: TestApp, name: string): Promise<string> => {
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
  const body = (await response.json()) as { sessionToken: string };
  return body.sessionToken;
};

const claimJob = async (app: TestApp, token: string): Promise<ClaimedJob> => {
  const response = await postJson(
    app,
    '/api/v1/cells/claims',
    {},
    bearer(token),
  );
  const body = (await response.json()) as { job: ClaimedJob | null };
  if (body.job === null) throw new Error('expected a claimed job');
  return body.job;
};

const reportLineUnavailable = async (
  app: TestApp,
  token: string,
  job: ClaimedJob,
  commandId: string,
): Promise<{ status: number; body: TransitionBody | ErrorBody }> => {
  const response = await postJson(
    app,
    `/api/v1/jobs/${job.jobId}/transitions`,
    {
      action: 'line_unavailable',
      commandId,
      epoch: job.epoch,
      lineName: 'feature',
      detail: 'no runner for feature line',
    },
    bearer(token),
  );
  return {
    status: response.status,
    body: (await response.json()) as TransitionBody | ErrorBody,
  };
};

const nextJobOf = (body: TransitionBody | ErrorBody): ClaimedJob => {
  if (
    !('nextJob' in body) ||
    body.nextJob === null ||
    body.nextJob === undefined
  )
    throw new Error('expected a nextJob');
  return body.nextJob;
};

const orderOf = (db: Db, orderId: string) =>
  db
    .select()
    .from(workOrders)
    .all()
    .find((candidate) => candidate.orderId === orderId);

const incidentsOf = (db: Db) => db.select().from(incidents).all();

const cellNamed = async (app: TestApp, name: string) => {
  const response = await getJson(
    app,
    '/api/v1/cells',
    bearer(SUPERVISOR_TOKEN),
  );
  const body = (await response.json()) as CellsBody;
  return body.cells.find((row) => row.name === name);
};

describe('job line_unavailable transition', () => {
  it('a line no other cell can run ends the order as line_unavailable and opens an incident', async () => {
    const { app, db } = setup();
    db.delete(workOrders)
      .where(eq(workOrders.orderId, asOrderId(SECOND_ORDER_ID)))
      .run();
    const token = await enrollCell(app, 'cell-a');
    const job = await claimJob(app, token);

    const { status, body } = await reportLineUnavailable(
      app,
      token,
      job,
      'line-1',
    );

    expect(status).toBe(200);
    expect(body).toMatchObject({
      action: 'line_unavailable',
      markedLineUnavailable: true,
      nextJob: null,
    });
    expect(orderOf(db, FIRST_ORDER_ID)).toMatchObject({
      state: 'line_unavailable',
      activeJobId: null,
      activeCellId: null,
    });
    expect(incidentsOf(db)).toEqual([
      expect.objectContaining({
        reason: 'line_unavailable',
        status: 'triaging',
        triageOwner: 'supervisor',
        failedJobId: job.jobId,
      }),
    ]);
    expect(await cellNamed(app, 'cell-a')).toMatchObject({
      activeJobId: null,
    });
  });

  it('a line another cell can run requeues the order for that cell', async () => {
    const { app, db } = setup();
    const tokenA = await enrollCell(app, 'cell-a');
    const tokenB = await enrollCell(app, 'cell-b');
    const job = await claimJob(app, tokenA);

    const { body } = await reportLineUnavailable(app, tokenA, job, 'line-1');

    expect(body).toMatchObject({ markedLineUnavailable: true });
    expect(orderOf(db, FIRST_ORDER_ID)).toMatchObject({ state: 'queued' });
    expect(incidentsOf(db)).toEqual([]);
    expect(await claimJob(app, tokenB)).toMatchObject({
      orderId: FIRST_ORDER_ID,
    });
  });

  it('the second queued order is handed to the same cell inline', async () => {
    const { app, db } = setup();
    const token = await enrollCell(app, 'cell-a');
    const job = await claimJob(app, token);

    const { status, body } = await reportLineUnavailable(
      app,
      token,
      job,
      'line-1',
    );

    expect(status).toBe(200);
    expect(nextJobOf(body)).toMatchObject({
      orderId: SECOND_ORDER_ID,
      epoch: 1,
    });
    expect(await cellNamed(app, 'cell-a')).toMatchObject({
      activeJobId: nextJobOf(body).jobId,
    });
    expect(orderOf(db, FIRST_ORDER_ID)).toMatchObject({
      state: 'line_unavailable',
    });
  });

  it('a cell is never handed back an order whose line it reported unavailable', async () => {
    const { app, db } = setup();
    const token = await enrollCell(app, 'cell-a');
    await enrollCell(app, 'cell-b');
    const first = await claimJob(app, token);
    const handed = nextJobOf(
      (await reportLineUnavailable(app, token, first, 'line-1'))
        .body as TransitionBody,
    );

    const { body } = await reportLineUnavailable(app, token, handed, 'line-2');

    expect(body).toMatchObject({ markedLineUnavailable: true, nextJob: null });
    expect(orderOf(db, FIRST_ORDER_ID)).toMatchObject({ state: 'queued' });
    expect(orderOf(db, SECOND_ORDER_ID)).toMatchObject({ state: 'queued' });
  });
});
