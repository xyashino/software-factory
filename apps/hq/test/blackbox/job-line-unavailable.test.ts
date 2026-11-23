import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { incidents } from '../../src/db/schema/incidents';
import { workOrders } from '../../src/db/schema/orders';
import { safeTokens } from '../../src/db/schema/tokens';
import {
  hashToken,
  TOKEN_PREFIXES,
} from '../../src/application/tokens/token-hash';
import { asOrderId, asTokenId } from '../../src/domain/common/brand';
import type { Db } from '../../src/db/client';
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
const OPERATOR_TOKEN = 'operator-test-token';
const FIRST_ORDER_ID = 'order-1';
const SECOND_ORDER_ID = 'order-2';
const CELL_A = 'cell-aaaaaaaa';
const CELL_B = 'cell-bbbbbbbb';

type ErrorBody = { code: number; type: string };

type ClaimedJob = { jobId: string; orderId: string; epoch: number };

type TransitionBody = {
  code: number;
  action?: string;
  markedLineUnavailable?: boolean;
  nextJob?: null | ClaimedJob;
};

const setup = () => {
  const { app, clock, db } = createTestApp({ safeTokenAuth: true });
  seedBaseline(db);
  db.insert(safeTokens)
    .values({
      tokenId: asTokenId('operator-1'),
      tokenHash: hashToken(OPERATOR_TOKEN),
      prefix: TOKEN_PREFIXES.operator,
      kind: 'operator',
      name: 'operator',
      scopesJson: ['operator:read', 'operator:write'],
      createdAt: clock.now(),
    })
    .run();
  return { app, clock, db };
};

const claimJob = async (
  app: TestApp,
  cellId: string,
  token: string = FACTORY_TOKEN,
): Promise<ClaimedJob> => {
  const response = await postJson(
    app,
    '/api/v1/cells/claims',
    claimBody({}, PROJECT_ID),
    factoryHeaders(cellId, token),
  );
  const body = (await response.json()) as { job: ClaimedJob | null };
  if (body.job === null) throw new Error('expected a claimed job');
  return body.job;
};

const reportLineUnavailable = async (
  app: TestApp,
  cellId: string,
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
    factoryHeaders(cellId),
  );
  return {
    status: response.status,
    body: (await response.json()) as TransitionBody | ErrorBody,
  };
};

const orderOf = (db: Db, orderId: string) =>
  db
    .select()
    .from(workOrders)
    .all()
    .find((candidate) => candidate.orderId === orderId);

const incidentsOf = (db: Db) => db.select().from(incidents).all();

const reportFactoryProject = (app: TestApp, token: string) =>
  postJson(
    app,
    '/api/v1/factories/heartbeat',
    {
      projects: [{ projectId: PROJECT_ID, desired: 1, running: 0 }],
    },
    { authorization: `Bearer ${token}` },
  );

describe('job line_unavailable transition', () => {
  it('a line no other factory can run ends the order as line_unavailable and opens an incident', async () => {
    const { app, db } = setup();
    db.delete(workOrders)
      .where(eq(workOrders.orderId, asOrderId(SECOND_ORDER_ID)))
      .run();
    const job = await claimJob(app, CELL_A);

    const { status, body } = await reportLineUnavailable(
      app,
      CELL_A,
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
      pinnedFactoryId: null,
    });
    expect(incidentsOf(db)).toEqual([
      expect.objectContaining({
        reason: 'line_unavailable',
        status: 'triaging',
        triageOwner: 'operator',
        failedJobId: job.jobId,
      }),
    ]);
  });

  it('a line another live factory can run requeues the order for that factory', async () => {
    const { app, clock, db } = setup();
    seedFactory(db, 'factory-2', SECOND_FACTORY_TOKEN, clock.now());
    await reportFactoryProject(app, SECOND_FACTORY_TOKEN);
    const job = await claimJob(app, CELL_A);

    const { body } = await reportLineUnavailable(app, CELL_A, job, 'line-1');

    expect(body).toMatchObject({ markedLineUnavailable: true });
    expect(orderOf(db, FIRST_ORDER_ID)).toMatchObject({ state: 'queued' });
    expect(incidentsOf(db)).toEqual([]);
    expect(await claimJob(app, CELL_B, SECOND_FACTORY_TOKEN)).toMatchObject({
      orderId: FIRST_ORDER_ID,
    });
  });

  it('the reporting cell claims the second queued order next', async () => {
    const { app } = setup();
    const job = await claimJob(app, CELL_A);

    const { status, body } = await reportLineUnavailable(
      app,
      CELL_A,
      job,
      'line-1',
    );

    expect(status).toBe(200);
    expect(body).toMatchObject({ nextJob: null });
    expect(await claimJob(app, CELL_A)).toMatchObject({
      orderId: SECOND_ORDER_ID,
      epoch: 1,
    });
  });

  it('a factory is never handed back an order whose line it reported unavailable', async () => {
    const { app, db } = setup();
    const first = await claimJob(app, CELL_A);
    await reportLineUnavailable(app, CELL_A, first, 'line-1');

    const sibling = await claimJob(app, CELL_B);

    expect(sibling).toMatchObject({ orderId: SECOND_ORDER_ID });
    expect(orderOf(db, FIRST_ORDER_ID)).toMatchObject({
      state: 'line_unavailable',
    });
  });
});
