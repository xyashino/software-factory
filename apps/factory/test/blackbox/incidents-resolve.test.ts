import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { incidents } from '../../src/db/schema/incidents';
import { jobs } from '../../src/db/schema/jobs';
import { orderSteps, workOrders } from '../../src/db/schema/orders';
import { safeTokens } from '../../src/db/schema/tokens';
import { hashToken } from '../../src/application/tokens/token-hash';
import { asOrderId, asTokenId } from '../../src/domain/common/brand';
import type { Db } from '../../src/db/client';
import {
  createTestApp,
  getJson,
  postJson,
  type TestApp,
} from '../support/test-app';
import { seedBaseline } from '../support/test-db';
import {
  claimBody,
  factoryHeaders,
  FACTORY_TOKEN,
} from '../support/factory-session';

const PROJECT_ID = 'proj-1';
const CELL_A = 'cell-aaaaaaaa';
const CELL_B = 'cell-bbbbbbbb';
const SUPERVISOR_TOKEN = 'supervisor-test-token';
const ORDER_ID = 'order-1';
const SECOND_ORDER_ID = 'order-2';

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

type ClaimedJob = {
  jobId: string;
  kind: string;
  stepId: string | null;
  epoch: number;
};

type TransitionBody = {
  code: number;
  action?: string;
  completed?: boolean;
  blocked?: boolean;
  nextJob?: null | ClaimedJob;
};

type IncidentBody = {
  incidentId: string;
  reason: string;
  status: string;
  triageOwner: string;
  resolutionAction: string | null;
};

type ResolveBody = {
  code: number;
  incident: IncidentBody;
  workOrder: {
    state: string;
    currentStepIndex: number;
    pinnedFactoryId: string | null;
  };
};

type ListBody = { items: IncidentBody[] };

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

const setup = () => {
  const { app, clock, db } = createTestApp({ safeTokenAuth: true });
  seedBaseline(db);
  db.delete(workOrders)
    .where(eq(workOrders.orderId, asOrderId(SECOND_ORDER_ID)))
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
  job: ClaimedJob,
  body: Record<string, unknown>,
): Promise<{ status: number; body: TransitionBody | ErrorBody }> => {
  const response = await postJson(
    app,
    `/api/v1/jobs/${job.jobId}/transitions`,
    { ...body, epoch: job.epoch },
    factoryHeaders(token),
  );
  return {
    status: response.status,
    body: (await response.json()) as TransitionBody | ErrorBody,
  };
};

const startJob = (app: TestApp, token: string, job: ClaimedJob) =>
  transition(app, token, job, {
    action: 'start',
    commandId: `start-${job.jobId}`,
    lineSnapshot: LINE_SNAPSHOT,
  });

const completeJob = (
  app: TestApp,
  token: string,
  job: ClaimedJob,
  producedFiles: string[],
  commandId: string,
) =>
  transition(app, token, job, {
    action: 'complete',
    commandId,
    producedFiles,
    commitSha: `sha-${commandId}`,
  });

const failJob = (
  app: TestApp,
  token: string,
  job: ClaimedJob,
  commandId: string,
) =>
  transition(app, token, job, {
    action: 'fail',
    commandId,
    detail: 'gate red',
  });

const nextJobOf = (body: TransitionBody | ErrorBody): ClaimedJob => {
  if (
    !('nextJob' in body) ||
    body.nextJob === null ||
    body.nextJob === undefined
  )
    throw new Error('expected a nextJob');
  return body.nextJob;
};

const resolveIncident = async (
  app: TestApp,
  token: string,
  incidentId: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: ResolveBody | ErrorBody }> => {
  const response = await postJson(
    app,
    `/api/v1/incidents/${incidentId}/resolve`,
    body,
    token === SUPERVISOR_TOKEN ? bearer(token) : factoryHeaders(token),
  );
  return {
    status: response.status,
    body: (await response.json()) as ResolveBody | ErrorBody,
  };
};

const listIncidents = async (
  app: TestApp,
  query: string,
  token = SUPERVISOR_TOKEN,
): Promise<{ status: number; body: ListBody | ErrorBody }> => {
  const response = await getJson(
    app,
    `/api/v1/incidents?projectId=${PROJECT_ID}${query}`,
    bearer(token),
  );
  return {
    status: response.status,
    body: (await response.json()) as ListBody | ErrorBody,
  };
};

const orderOf = (db: Db) =>
  db
    .select()
    .from(workOrders)
    .all()
    .find((candidate) => candidate.orderId === ORDER_ID);

const onlyIncident = (db: Db) => {
  const rows = db.select().from(incidents).all();
  const [row] = rows;
  if (row === undefined || rows.length !== 1)
    throw new Error(`expected 1 incident, got ${rows.length}`);
  return row;
};

const buildStepId = (db: Db): string => {
  const step = db
    .select()
    .from(orderSteps)
    .all()
    .find(
      (candidate) =>
        candidate.orderId === ORDER_ID && candidate.stationId === 'build',
    );
  if (step === undefined) throw new Error('no build step');
  return step.stepId;
};

const exhaustBuildRetries = async (
  app: TestApp,
  token: string,
): Promise<void> => {
  const job = await claimJob(app, token);
  await startJob(app, token, job);
  const retry = nextJobOf(
    (await failJob(app, token, job, 'fail-1')).body as TransitionBody,
  );
  await startJob(app, token, retry);
  await failJob(app, token, retry, 'fail-2');
};

const escalatedByMechanic = async (
  app: TestApp,
  db: Db,
  token: string,
): Promise<void> => {
  await exhaustBuildRetries(app, token);
  const mechanic = await claimJob(app, token);
  await resolveIncident(app, token, onlyIncident(db).incidentId, {
    action: 'escalate',
    epoch: mechanic.epoch,
  });
};

describe('incident listing and resolution', () => {
  it('a supervisor lists the incidents of a project filtered by reason and status', async () => {
    const { app, db } = setup();
    const token = CELL_A;
    await exhaustBuildRetries(app, token);

    const byReason = await listIncidents(app, '&reason=step_retries_exhausted');
    const byStatus = await listIncidents(app, '&status=triaging');
    const otherReason = await listIncidents(app, '&reason=line_unavailable');

    expect(byReason.body).toMatchObject({
      items: [{ incidentId: onlyIncident(db).incidentId }],
    });
    expect(byStatus.body).toMatchObject({
      items: [{ status: 'triaging', triageOwner: 'mechanic' }],
    });
    expect(otherReason.body).toMatchObject({ items: [] });
  });

  it('a token without supervisor:read cannot list incidents', async () => {
    const { app } = setup();
    const token = FACTORY_TOKEN;

    const { status, body } = await listIncidents(app, '', token);

    expect(status).toBe(403);
    expect(body).toMatchObject({ code: 403 });
  });

  it('a supervisor retries a failed step with a new attempt and the order requeues', async () => {
    const { app, db } = setup();
    const token = CELL_A;
    await exhaustBuildRetries(app, token);

    const { status, body } = await resolveIncident(
      app,
      SUPERVISOR_TOKEN,
      onlyIncident(db).incidentId,
      { action: 'retry_step', stepIndex: 0 },
    );

    expect(status).toBe(200);
    expect(body).toMatchObject({
      incident: { status: 'resolved', resolutionAction: 'retry_step' },
      workOrder: { state: 'queued', currentStepIndex: 0 },
    });
    expect(orderOf(db)).toMatchObject({ state: 'queued' });
  });

  it('a supervisor restarts from an earlier step that is not past the failed one', async () => {
    const { app, db } = setup();
    const token = CELL_A;
    await exhaustBuildRetries(app, token);

    const { status, body } = await resolveIncident(
      app,
      SUPERVISOR_TOKEN,
      onlyIncident(db).incidentId,
      { action: 'restart_from_step', stepIndex: 0 },
    );

    expect(status).toBe(200);
    expect(body).toMatchObject({
      incident: { status: 'resolved', resolutionAction: 'restart_from_step' },
      workOrder: { state: 'queued', currentStepIndex: 0 },
    });
  });

  it('a restart step after the failed step is refused with 422', async () => {
    const { app, db } = setup();
    const token = CELL_A;
    await exhaustBuildRetries(app, token);

    const { status, body } = await resolveIncident(
      app,
      SUPERVISOR_TOKEN,
      onlyIncident(db).incidentId,
      { action: 'restart_from_step', stepIndex: 1 },
    );

    expect(status).toBe(422);
    expect(body).toMatchObject({ code: 422 });
    expect(onlyIncident(db)).toMatchObject({ status: 'triaging' });
  });

  it('a supervisor restarts the order from scratch on a fresh workspace', async () => {
    const { app, db } = setup();
    const token = CELL_A;
    await exhaustBuildRetries(app, token);

    const { status, body } = await resolveIncident(
      app,
      SUPERVISOR_TOKEN,
      onlyIncident(db).incidentId,
      { action: 'restart_from_scratch' },
    );

    expect(status).toBe(200);
    expect(body).toMatchObject({
      incident: { resolutionAction: 'restart_from_scratch' },
      workOrder: { state: 'queued', currentStepIndex: 0 },
    });
  });

  it('a supervisor escalates an incident and the order stays blocked', async () => {
    const { app, db } = setup();
    const token = CELL_A;
    await exhaustBuildRetries(app, token);

    const { status, body } = await resolveIncident(
      app,
      SUPERVISOR_TOKEN,
      onlyIncident(db).incidentId,
      { action: 'escalate' },
    );

    expect(status).toBe(200);
    expect(body).toMatchObject({
      incident: { status: 'escalated', triageOwner: 'supervisor' },
      workOrder: { state: 'blocked' },
    });
  });

  it('a supervisor cancels an incident and the order is cancelled without its pinned factory', async () => {
    const { app, db } = setup();
    await exhaustBuildRetries(app, CELL_A);

    const { status, body } = await resolveIncident(
      app,
      SUPERVISOR_TOKEN,
      onlyIncident(db).incidentId,
      { action: 'cancel' },
    );

    expect(status).toBe(200);
    expect(body).toMatchObject({
      incident: { status: 'cancelled', resolutionAction: 'cancel' },
      workOrder: { state: 'cancelled', pinnedFactoryId: null },
    });
  });

  it('an incident that is already resolved cannot be resolved again', async () => {
    const { app, db } = setup();
    const token = CELL_A;
    await exhaustBuildRetries(app, token);
    const incidentId = onlyIncident(db).incidentId;
    await resolveIncident(app, SUPERVISOR_TOKEN, incidentId, {
      action: 'retry_step',
      stepIndex: 0,
    });

    const { status } = await resolveIncident(
      app,
      SUPERVISOR_TOKEN,
      incidentId,
      {
        action: 'cancel',
      },
    );

    expect(status).toBe(422);
  });

  it('the mechanic cell claims the mechanic job for the incident its order blocked on', async () => {
    const { app } = setup();
    const token = CELL_A;
    await exhaustBuildRetries(app, token);

    const job = await claimJob(app, token);

    expect(job).toMatchObject({ kind: 'mechanic', stepId: null, epoch: 1 });
  });

  it('the mechanic job claim names the incident it triages', async () => {
    const { app, db } = setup();
    const token = CELL_A;
    await exhaustBuildRetries(app, token);

    const response = await postJson(
      app,
      '/api/v1/cells/claims',
      claimBody({}, PROJECT_ID),
      factoryHeaders(token),
    );
    const body = (await response.json()) as { job: { incidentId: string } };

    expect(body.job.incidentId).toBe(onlyIncident(db).incidentId);
  });

  it('starting a mechanic job runs it without moving its order steps', async () => {
    const { app, db } = setup();
    const token = CELL_A;
    await exhaustBuildRetries(app, token);
    const mechanic = await claimJob(app, token);
    const stepsBefore = db.select().from(orderSteps).all();

    const { status } = await startJob(app, token, mechanic);

    expect(status).toBe(200);
    expect(db.select().from(jobs).all()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'mechanic',
          status: 'running',
          stepId: null,
        }),
      ]),
    );
    expect(db.select().from(orderSteps).all()).toEqual(stepsBefore);
  });

  it('the mechanic cell resolves its leased incident and its mechanic job passes', async () => {
    const { app, db } = setup();
    const token = CELL_A;
    await exhaustBuildRetries(app, token);
    const mechanic = await claimJob(app, token);

    const { status, body } = await resolveIncident(
      app,
      token,
      onlyIncident(db).incidentId,
      { action: 'retry_step', stepIndex: 0, epoch: mechanic.epoch },
    );

    expect(status).toBe(200);
    expect(body).toMatchObject({
      incident: { status: 'resolved', resolutionAction: 'retry_step' },
      workOrder: { state: 'queued' },
    });
    expect(db.select().from(jobs).all()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'mechanic', status: 'passed' }),
      ]),
    );
  });

  it('a mechanic resolution with a stale epoch gets 409 StaleLeaseEpoch', async () => {
    const { app, db } = setup();
    const token = CELL_A;
    await exhaustBuildRetries(app, token);
    const mechanic = await claimJob(app, token);

    const { status, body } = await resolveIncident(
      app,
      token,
      onlyIncident(db).incidentId,
      { action: 'cancel', epoch: mechanic.epoch + 1 },
    );

    expect(status).toBe(409);
    expect(body).toMatchObject({ type: 'stale-lease-epoch' });
    expect(onlyIncident(db)).toMatchObject({ status: 'triaging' });
  });

  it('a cell holding no mechanic lease cannot resolve the incident', async () => {
    const { app, db } = setup();
    const token = CELL_A;
    const otherToken = CELL_B;
    await exhaustBuildRetries(app, token);
    const mechanic = await claimJob(app, token);

    const { status } = await resolveIncident(
      app,
      otherToken,
      onlyIncident(db).incidentId,
      { action: 'cancel', epoch: mechanic.epoch },
    );

    expect(status).toBe(403);
    expect(onlyIncident(db)).toMatchObject({ status: 'triaging' });
  });

  it('a mechanic resolution without an epoch is refused with 400', async () => {
    const { app, db } = setup();
    const token = CELL_A;
    await exhaustBuildRetries(app, token);
    await claimJob(app, token);

    const { status } = await resolveIncident(
      app,
      token,
      onlyIncident(db).incidentId,
      { action: 'cancel' },
    );

    expect(status).toBe(400);
  });

  it('a step that fails until its retries run out goes to the mechanic, which retries it and the order delivers', async () => {
    const { app, db } = setup();
    const token = CELL_A;
    await exhaustBuildRetries(app, token);
    const mechanic = await claimJob(app, token);
    await resolveIncident(app, token, onlyIncident(db).incidentId, {
      action: 'retry_step',
      stepIndex: 0,
      epoch: mechanic.epoch,
    });

    const build = await claimJob(app, token);
    expect(build).toMatchObject({
      kind: 'run_operator',
      stepId: buildStepId(db),
    });
    await startJob(app, token, build);
    const review = nextJobOf(
      (await completeJob(app, token, build, ['report.md'], 'build-retry'))
        .body as TransitionBody,
    );
    await startJob(app, token, review);
    const deliver = nextJobOf(
      (await completeJob(app, token, review, ['review.md'], 'review-1'))
        .body as TransitionBody,
    );
    await startJob(app, token, deliver);
    const delivered = await completeJob(app, token, deliver, [], 'deliver-1');

    expect(delivered.body).toMatchObject({ completed: true, nextJob: null });
    expect(orderOf(db)).toMatchObject({ state: 'delivered' });
    expect(onlyIncident(db)).toMatchObject({ status: 'resolved' });
  });

  it('the mechanic escalates and the supervisor restarts the order from its failed step', async () => {
    const { app, db } = setup();
    const token = CELL_A;
    await escalatedByMechanic(app, db, token);

    const { status, body } = await resolveIncident(
      app,
      SUPERVISOR_TOKEN,
      onlyIncident(db).incidentId,
      { action: 'restart_from_step', stepIndex: 0 },
    );

    expect(status).toBe(200);
    expect(body).toMatchObject({
      incident: { status: 'resolved', resolutionAction: 'restart_from_step' },
      workOrder: { state: 'queued', currentStepIndex: 0 },
    });
  });

  it('the mechanic escalates and the supervisor restarts the order from scratch', async () => {
    const { app, db } = setup();
    const token = CELL_A;
    await escalatedByMechanic(app, db, token);

    const { status, body } = await resolveIncident(
      app,
      SUPERVISOR_TOKEN,
      onlyIncident(db).incidentId,
      { action: 'restart_from_scratch' },
    );

    expect(status).toBe(200);
    expect(body).toMatchObject({
      incident: { resolutionAction: 'restart_from_scratch' },
      workOrder: { state: 'queued', currentStepIndex: 0 },
    });
  });
});
