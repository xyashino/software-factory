import { describe, expect, it } from 'vitest';
import { orderSteps, workOrders } from '../../src/db/schema/orders';
import { stateTransitions } from '../../src/db/schema/transitions';
import { safeTokens } from '../../src/db/schema/tokens';
import {
  hashToken,
  TOKEN_PREFIXES,
} from '../../src/application/tokens/token-hash';
import {
  asOrderId,
  asProjectId,
  asTokenId,
} from '../../src/domain/common/brand';
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
const ORDER_ID = 'order-1';

const LINE_SNAPSHOT = {
  name: 'feature',
  stations: [
    {
      id: 'build',
      kind: 'operator',
      requiredFiles: ['report.md'],
      maxAttempts: 2,
    },
    {
      id: 'review',
      kind: 'inspection',
      requiredFiles: ['review.md'],
      maxAttempts: 2,
    },
    { id: 'deliver', kind: 'deliver', requiredFiles: [], maxAttempts: 1 },
  ],
};

type ErrorBody = { code: number; type: string };

type ClaimedJob = { jobId: string; epoch: number };

type TransitionBody = {
  code: number;
  action?: string;
  status?: string;
  completed?: boolean;
  nextJob?: null | { jobId: string; epoch: number; stepId: string | null };
};

type CellsBody = {
  cells: {
    name: string;
    status: string;
    activeJobId: string | null;
  }[];
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

const transition = async (
  app: TestApp,
  token: string,
  jobId: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: TransitionBody | ErrorBody }> => {
  const response = await postJson(
    app,
    `/api/v1/jobs/${jobId}/transitions`,
    body,
    bearer(token),
  );
  return {
    status: response.status,
    body: (await response.json()) as TransitionBody | ErrorBody,
  };
};

const startJob = (
  app: TestApp,
  token: string,
  job: ClaimedJob,
  commandId = `start-${job.jobId}`,
) =>
  transition(app, token, job.jobId, {
    action: 'start',
    commandId,
    epoch: job.epoch,
    lineSnapshot: LINE_SNAPSHOT,
  });

const completeJob = (
  app: TestApp,
  token: string,
  job: ClaimedJob,
  producedFiles: string[],
  commandId: string,
) =>
  transition(app, token, job.jobId, {
    action: 'complete',
    commandId,
    epoch: job.epoch,
    producedFiles,
    commitSha: `sha-${commandId}`,
  });

const cellNamed = async (app: TestApp, name: string) => {
  const response = await getJson(
    app,
    '/api/v1/cells',
    bearer(SUPERVISOR_TOKEN),
  );
  const body = (await response.json()) as CellsBody;
  return body.cells.find((row) => row.name === name);
};

const seedChildOrder = (db: Db) => {
  db.insert(workOrders)
    .values({
      orderId: asOrderId('child-1'),
      projectId: asProjectId(PROJECT_ID),
      parentOrderId: asOrderId(ORDER_ID),
      slug: 'child-1',
      title: 'child-1',
      type: 'feat',
      description: 'waits for parent',
      lineName: 'feature',
      unavailableLineCellsJson: [],
      priority: 'medium',
      baseBranch: 'main',
      branch: 'factory/child-1',
      state: 'waiting_parent',
      version: 1,
      createdAt: 1,
      updatedAt: 1,
    })
    .run();
};

describe('job start and complete transitions', () => {
  it('start on step 0 materializes the line steps', async () => {
    const { app, db } = setup();
    const token = await enrollCell(app, 'cell-a');
    const job = await claimJob(app, token);

    const { status, body } = await startJob(app, token, job);

    expect(status).toBe(200);
    expect(body).toMatchObject({ action: 'start', status: 'running' });
    const steps = db
      .select()
      .from(orderSteps)
      .all()
      .filter((step) => step.orderId === ORDER_ID);
    expect(steps.map((step) => step.stationId)).toEqual([
      'build',
      'review',
      'deliver',
    ]);
    expect(steps.find((step) => step.stationId === 'build')?.state).toBe(
      'running',
    );
  });

  it('completing an intermediate step returns the next job inline on the same cell', async () => {
    const { app } = setup();
    const token = await enrollCell(app, 'cell-a');
    const job = await claimJob(app, token);
    await startJob(app, token, job);

    const { status, body } = await completeJob(
      app,
      token,
      job,
      ['report.md'],
      'complete-build',
    );

    expect(status).toBe(200);
    expect(body).toMatchObject({ completed: true });
    const nextJob = (body as TransitionBody).nextJob;
    expect(nextJob).toMatchObject({ epoch: job.epoch + 1 });
    const cell = await cellNamed(app, 'cell-a');
    expect(cell).toMatchObject({ status: 'busy' });
    expect(cell?.activeJobId).toBe(nextJob?.jobId);
  });

  it('completing deliver clears the cell locks and unlocks waiting children', async () => {
    const { app, db } = setup();
    seedChildOrder(db);
    const token = await enrollCell(app, 'cell-a');
    const job = await claimJob(app, token);
    await startJob(app, token, job);
    const build = await completeJob(app, token, job, ['report.md'], 'c-build');
    const review = (build.body as TransitionBody).nextJob;
    if (review === null || review === undefined) throw new Error('no review');
    await transition(app, token, review.jobId, {
      action: 'start',
      commandId: 'start-review',
      epoch: review.epoch,
    });
    const reviewed = await completeJob(
      app,
      token,
      { jobId: review.jobId, epoch: review.epoch },
      ['review.md'],
      'c-review',
    );
    const deliver = (reviewed.body as TransitionBody).nextJob;
    if (deliver === null || deliver === undefined)
      throw new Error('no deliver');
    await transition(app, token, deliver.jobId, {
      action: 'start',
      commandId: 'start-deliver',
      epoch: deliver.epoch,
    });

    const { status, body } = await completeJob(
      app,
      token,
      { jobId: deliver.jobId, epoch: deliver.epoch },
      [],
      'c-deliver',
    );

    expect(status).toBe(200);
    expect(body).toMatchObject({ completed: true, nextJob: null });
    const cell = await cellNamed(app, 'cell-a');
    expect(cell).toMatchObject({ status: 'online', activeJobId: null });
    const child = db
      .select()
      .from(workOrders)
      .all()
      .find((row) => row.orderId === 'child-1');
    expect(child?.state).toBe('queued');
    expect(child?.baseCommitSha).toBe('sha-c-deliver');
  });

  it('a stale epoch gets 409 StaleLeaseEpoch', async () => {
    const { app } = setup();
    const token = await enrollCell(app, 'cell-a');
    const job = await claimJob(app, token);

    const { status, body } = await transition(app, token, job.jobId, {
      action: 'start',
      commandId: 'start-stale',
      epoch: job.epoch + 1,
      lineSnapshot: LINE_SNAPSHOT,
    });

    expect(status).toBe(409);
    expect(body).toMatchObject({ type: 'stale-lease-epoch' });
  });

  it('a different cell gets 409 StaleLeaseEpoch', async () => {
    const { app } = setup();
    const owner = await enrollCell(app, 'cell-a');
    const other = await enrollCell(app, 'cell-b');
    const job = await claimJob(app, owner);

    const { status, body } = await startJob(app, other, job);

    expect(status).toBe(409);
    expect(body).toMatchObject({ type: 'stale-lease-epoch' });
  });

  it('repeating a commandId returns the first result without a second transition', async () => {
    const { app, db } = setup();
    const token = await enrollCell(app, 'cell-a');
    const job = await claimJob(app, token);

    const first = await startJob(app, token, job, 'cmd-repeat');
    const second = await startJob(app, token, job, 'cmd-repeat');

    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    const rows = db
      .select()
      .from(stateTransitions)
      .all()
      .filter((row) => row.commandId === 'cmd-repeat');
    expect(rows).toHaveLength(1);
  });

  it('completing without a required file is rejected with 422', async () => {
    const { app } = setup();
    const token = await enrollCell(app, 'cell-a');
    const job = await claimJob(app, token);
    await startJob(app, token, job);

    const { status, body } = await completeJob(
      app,
      token,
      job,
      [],
      'complete-missing',
    );

    expect(status).toBe(422);
    expect(body).toMatchObject({ type: 'unprocessable-entity' });
  });
});
