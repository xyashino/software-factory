import { describe, expect, it } from 'vitest';
import { incidents } from '../../src/db/schema/incidents';
import { jobs } from '../../src/db/schema/jobs';
import { orderSteps, workOrders } from '../../src/db/schema/orders';
import { safeTokens } from '../../src/db/schema/tokens';
import { hashToken } from '../../src/application/tokens/token-hash';
import { asTokenId } from '../../src/domain/common/brand';
import type { Db } from '../../src/db/client';
import { createTestApp, postJson, type TestApp } from '../support/test-app';
import { seedBaseline } from '../support/test-db';
import { claimBody, factoryHeaders } from '../support/factory-session';

const PROJECT_ID = 'proj-1';
const CELL = 'cell-aaaaaaaa';
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
      onFailRetryStationId: 'build',
    },
    { id: 'deliver', kind: 'deliver', requiredFiles: [], maxAttempts: 1 },
  ],
};

type ErrorBody = { code: number; type: string };

type ClaimedJob = { jobId: string; epoch: number };

type NextJob = ClaimedJob & { stepId: string | null; workspaceMode: string };

type TransitionBody = {
  code: number;
  action?: string;
  status?: string;
  completed?: boolean;
  failed?: boolean;
  blocked?: boolean;
  resetToScratch?: boolean;
  nextJob?: null | NextJob;
};

const setup = () => {
  const { app, clock, db } = createTestApp({ safeTokenAuth: true });
  seedBaseline(db);
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

const claimJob = async (app: TestApp, token: string): Promise<ClaimedJob> => {
  const response = await postJson(
    app,
    '/api/v1/cells/claims',
    claimBody({}, PROJECT_ID),
    factoryHeaders(token),
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
    factoryHeaders(token),
  );
  return {
    status: response.status,
    body: (await response.json()) as TransitionBody | ErrorBody,
  };
};

const startJob = (app: TestApp, token: string, job: ClaimedJob) =>
  transition(app, token, job.jobId, {
    action: 'start',
    commandId: `start-${job.jobId}`,
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

const failJob = (
  app: TestApp,
  token: string,
  job: ClaimedJob,
  commandId: string,
  detail = 'gate red',
) =>
  transition(app, token, job.jobId, {
    action: 'fail',
    commandId,
    epoch: job.epoch,
    detail,
  });

const nextJobOf = (body: TransitionBody | ErrorBody): NextJob => {
  if (
    !('nextJob' in body) ||
    body.nextJob === null ||
    body.nextJob === undefined
  )
    throw new Error('expected a nextJob');
  return body.nextJob;
};

const stepIdOf = (db: Db, stationId: string): string => {
  const step = db
    .select()
    .from(orderSteps)
    .all()
    .find(
      (candidate) =>
        candidate.orderId === ORDER_ID && candidate.stationId === stationId,
    );
  if (step === undefined) throw new Error(`no step for ${stationId}`);
  return step.stepId;
};

const stepStateOf = (db: Db, stationId: string): string | undefined =>
  db
    .select()
    .from(orderSteps)
    .all()
    .find(
      (candidate) =>
        candidate.orderId === ORDER_ID && candidate.stationId === stationId,
    )?.state;

const orderOf = (db: Db) =>
  db
    .select()
    .from(workOrders)
    .all()
    .find((candidate) => candidate.orderId === ORDER_ID);

const incidentsOf = (db: Db) => db.select().from(incidents).all();

describe('job fail, block and worktree_missing transitions', () => {
  it('a failed step with retries left hands the same step to a new job inline', async () => {
    const { app, db } = setup();
    const token = CELL;
    const job = await claimJob(app, token);
    await startJob(app, token, job);

    const { status, body } = await failJob(app, token, job, 'fail-build');

    expect(status).toBe(200);
    expect(body).toMatchObject({ action: 'fail', failed: true });
    expect(nextJobOf(body)).toMatchObject({
      epoch: job.epoch + 1,
      stepId: stepIdOf(db, 'build'),
      workspaceMode: 'reuse',
    });
    expect(orderOf(db)).toMatchObject({ state: 'running' });
  });

  it('a rewind target sends the line back to that step on the same cell', async () => {
    const { app, db } = setup();
    const token = CELL;
    const job = await claimJob(app, token);
    await startJob(app, token, job);
    const build = await completeJob(app, token, job, ['report.md'], 'build');
    const review = nextJobOf(build.body as TransitionBody);
    await startJob(app, token, review);

    const { body } = await failJob(app, token, review, 'fail-review');

    expect(nextJobOf(body as TransitionBody)).toMatchObject({
      stepId: stepIdOf(db, 'build'),
      epoch: review.epoch + 1,
    });
    expect(stepStateOf(db, 'review')).toBe('pending');
  });

  it('the last failed attempt blocks the order and opens a step_retries_exhausted incident', async () => {
    const { app, db } = setup();
    const token = CELL;
    const job = await claimJob(app, token);
    await startJob(app, token, job);
    const retry = nextJobOf(
      (await failJob(app, token, job, 'fail-1')).body as TransitionBody,
    );
    await startJob(app, token, retry);

    const { status, body } = await failJob(app, token, retry, 'fail-2');

    expect(status).toBe(200);
    expect(body).toMatchObject({ action: 'fail', blocked: true });
    expect(orderOf(db)).toMatchObject({
      state: 'blocked',
      activeJobId: null,
      activeCellId: null,
    });
    expect(incidentsOf(db)).toEqual([
      expect.objectContaining({
        reason: 'step_retries_exhausted',
        status: 'triaging',
        triageOwner: 'mechanic',
        failedJobId: retry.jobId,
      }),
    ]);
  });

  it('a failed delivery on its only attempt opens a delivery_failed incident', async () => {
    const { app, db } = setup();
    const token = CELL;
    const job = await claimJob(app, token);
    await startJob(app, token, job);
    const build = await completeJob(app, token, job, ['report.md'], 'build');
    const review = nextJobOf(build.body as TransitionBody);
    await startJob(app, token, review);
    const reviewed = await completeJob(
      app,
      token,
      review,
      ['review.md'],
      'review',
    );
    const deliver = nextJobOf(reviewed.body as TransitionBody);
    await startJob(app, token, deliver);

    const { body } = await failJob(app, token, deliver, 'fail-deliver');

    expect(body).toMatchObject({ blocked: true });
    expect(incidentsOf(db)).toEqual([
      expect.objectContaining({ reason: 'delivery_failed' }),
    ]);
  });

  it('block opens an operator_blocked incident that keeps the handover file', async () => {
    const { app, db } = setup();
    const token = CELL;
    const job = await claimJob(app, token);
    await startJob(app, token, job);

    const { status, body } = await transition(app, token, job.jobId, {
      action: 'block',
      commandId: 'block-1',
      epoch: job.epoch,
      detail: 'needs a design call',
      handoverFile: '.cell/handover.md',
    });

    expect(status).toBe(200);
    expect(body).toMatchObject({ action: 'block', blocked: true });
    expect(orderOf(db)).toMatchObject({ state: 'blocked', activeJobId: null });
    expect(incidentsOf(db)).toEqual([
      expect.objectContaining({
        reason: 'operator_blocked',
        detail: 'needs a design call (handover: .cell/handover.md)',
      }),
    ]);
  });

  it('a missing worktree resets the line to step 0 with a fresh workspace', async () => {
    const { app, db } = setup();
    const token = CELL;
    const job = await claimJob(app, token);
    await startJob(app, token, job);

    const { status, body } = await transition(app, token, job.jobId, {
      action: 'worktree_missing',
      commandId: 'missing-1',
      epoch: job.epoch,
      missingStepId: stepIdOf(db, 'build'),
      missingFiles: ['report.md'],
    });

    expect(status).toBe(200);
    expect(body).toMatchObject({
      action: 'worktree_missing',
      resetToScratch: true,
    });
    expect(nextJobOf(body as TransitionBody)).toMatchObject({
      stepId: stepIdOf(db, 'build'),
      workspaceMode: 'fresh',
      epoch: job.epoch + 1,
    });
    expect(orderOf(db)).toMatchObject({
      worktreeResets: 1,
      currentStepIndex: 0,
    });
  });

  it('a cell reports a missing worktree before it starts the job', async () => {
    const { app, db } = setup();
    const token = CELL;
    const first = await claimJob(app, token);
    await startJob(app, token, first);
    const retry = nextJobOf(
      (await failJob(app, token, first, 'fail-build')).body,
    );

    const { status, body } = await transition(app, token, retry.jobId, {
      action: 'worktree_missing',
      commandId: 'missing-claimed',
      epoch: retry.epoch,
      missingStepId: stepIdOf(db, 'build'),
      missingFiles: ['.cell/worktree.json'],
    });

    expect(status).toBe(200);
    expect(body).toMatchObject({
      action: 'worktree_missing',
      resetToScratch: true,
    });
    expect(orderOf(db)).toMatchObject({
      worktreeResets: 1,
      currentStepIndex: 0,
    });
  });

  it('the third worktree reset blocks the order with a worktree_reset_limit incident', async () => {
    const { app, db } = setup();
    const token = CELL;
    let job = await claimJob(app, token);
    await startJob(app, token, job);
    const missingStepId = stepIdOf(db, 'build');

    for (const commandId of ['missing-1', 'missing-2']) {
      const reset = await transition(app, token, job.jobId, {
        action: 'worktree_missing',
        commandId,
        epoch: job.epoch,
        missingStepId,
        missingFiles: ['report.md'],
      });
      job = nextJobOf(reset.body as TransitionBody);
      await startJob(app, token, job);
    }
    const { body } = await transition(app, token, job.jobId, {
      action: 'worktree_missing',
      commandId: 'missing-3',
      epoch: job.epoch,
      missingStepId,
      missingFiles: ['report.md'],
    });

    expect(body).toMatchObject({ action: 'worktree_missing', blocked: true });
    expect(orderOf(db)).toMatchObject({ state: 'blocked', worktreeResets: 3 });
    expect(incidentsOf(db)).toEqual([
      expect.objectContaining({
        reason: 'worktree_reset_limit',
        triageOwner: 'mechanic',
      }),
    ]);
  });

  it('a fail with a stale epoch gets 409 StaleLeaseEpoch', async () => {
    const { app } = setup();
    const token = CELL;
    const job = await claimJob(app, token);
    await startJob(app, token, job);

    const { status, body } = await transition(app, token, job.jobId, {
      action: 'fail',
      commandId: 'fail-stale',
      epoch: job.epoch + 5,
      detail: 'gate red',
    });

    expect(status).toBe(409);
    expect(body).toMatchObject({ type: 'stale-lease-epoch' });
  });

  it('a replayed block returns the first result and opens no second incident', async () => {
    const { app, db } = setup();
    const token = CELL;
    const job = await claimJob(app, token);
    await startJob(app, token, job);
    const command = {
      action: 'block',
      commandId: 'block-replay',
      epoch: job.epoch,
      detail: 'needs a call',
    };

    const first = await transition(app, token, job.jobId, command);
    const replay = await transition(app, token, job.jobId, command);

    expect(replay).toEqual(first);
    expect(incidentsOf(db)).toHaveLength(1);
  });

  it('a quality-gate fail rewinds to build and the order delivers on one cell without re-claiming', async () => {
    const { app, db } = setup();
    const token = CELL;
    const job = await claimJob(app, token);
    await startJob(app, token, job);

    const build = await completeJob(app, token, job, ['report.md'], 'build-1');
    const review = nextJobOf(build.body as TransitionBody);
    await startJob(app, token, review);
    const rewound = await failJob(app, token, review, 'review-fail');
    const rebuild = nextJobOf(rewound.body as TransitionBody);
    expect(rebuild.stepId).toBe(stepIdOf(db, 'build'));
    await startJob(app, token, rebuild);

    const rebuilt = await completeJob(
      app,
      token,
      rebuild,
      ['report.md'],
      'build-2',
    );
    const review2 = nextJobOf(rebuilt.body as TransitionBody);
    await startJob(app, token, review2);
    const reviewed = await completeJob(
      app,
      token,
      review2,
      ['review.md'],
      'review-2',
    );
    const deliver = nextJobOf(reviewed.body as TransitionBody);
    await startJob(app, token, deliver);

    const delivered = await completeJob(app, token, deliver, [], 'deliver');

    expect(delivered.body).toMatchObject({ completed: true, nextJob: null });
    expect(orderOf(db)).toMatchObject({ state: 'delivered' });
    expect(incidentsOf(db)).toEqual([]);
    expect(db.select().from(jobs).all()).toHaveLength(5);
  });
});
