import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { LEASE_TTL_MS } from '../../src/config';
import { jobs } from '../../src/db/schema/jobs';
import { workOrders } from '../../src/db/schema/orders';
import { projects } from '../../src/db/schema/projects';
import { safeTokens } from '../../src/db/schema/tokens';
import {
  hashToken,
  TOKEN_PREFIXES,
} from '../../src/application/tokens/token-hash';
import {
  asJobId,
  asOrderId,
  asProjectId,
  asTokenId,
} from '../../src/domain/common/brand';
import { createTestApp, postJson, type TestApp } from '../support/test-app';
import { seedBaseline } from '../support/test-db';
import {
  claimBody,
  factoryHeaders,
  seedFactory,
} from '../support/factory-session';
import type { Db } from '../../src/db/client';

const PROJECT_ID = 'proj-1';
const SUPERVISOR_TOKEN = 'supervisor-test-token';
const LONG_WAIT_MS = 5_000;
const PROMPT_MS = 1_000;
const CELL_A = 'cell-aaaaaaaa';
const CELL_B = 'cell-bbbbbbbb';
const CELL_C = 'cell-cccccccc';
const CELL_D = 'cell-dddddddd';
const CELL_E = 'cell-eeeeeeee';
const CELL_F = 'cell-ffffffff';

const setup = () => {
  const { app, clock, db } = createTestApp({ safeTokenAuth: true });
  seedBaseline(db);
  db.insert(safeTokens)
    .values({
      tokenId: asTokenId('supervisor-1'),
      tokenHash: hashToken(SUPERVISOR_TOKEN),
      prefix: TOKEN_PREFIXES.supervisor,
      kind: 'supervisor',
      name: 'supervisor',
      scopesJson: ['supervisor:write'],
      createdAt: clock.now(),
    })
    .run();
  return { app, clock, db };
};

type ClaimBody = {
  code: number;
  job: null | {
    jobId: string;
    kind: string;
    orderId: string | null;
    planId: string | null;
    workspaceMode: string;
    epoch: number;
    leaseExpiresAt: number;
    targetBranch: string;
    payload: Record<string, unknown>;
  };
  signals?: string[];
};

const claim = async (
  app: TestApp,
  cellId: string,
  options: { waitMs?: number; allowedLines?: string[]; token?: string } = {},
): Promise<{ status: number; body: ClaimBody }> => {
  const response = await postJson(
    app,
    '/api/v1/cells/claims',
    claimBody(
      options.waitMs === undefined ? {} : { waitMs: options.waitMs },
      PROJECT_ID,
      options.allowedLines,
    ),
    factoryHeaders(cellId, options.token),
  );
  return {
    status: response.status,
    body: (await response.json()) as ClaimBody,
  };
};

const queueImport = (app: TestApp, slug: string, line: string) =>
  postJson(
    app,
    '/api/v1/queue/import',
    {
      projectId: PROJECT_ID,
      commandId: `import-${slug}`,
      mode: 'apply',
      files: [
        {
          filename: `${slug}.md`,
          markdown: [
            '---',
            `line: ${line}`,
            '---',
            '',
            `# ${slug}: Title ${slug}`,
            '',
          ].join('\n'),
        },
      ],
    },
    { authorization: `Bearer ${SUPERVISOR_TOKEN}` },
  );

const orderState = (db: Db, orderId: string) =>
  db
    .select()
    .from(workOrders)
    .where(eq(workOrders.orderId, asOrderId(orderId)))
    .get();

const jobRow = (db: Db, jobId: string) =>
  db
    .select()
    .from(jobs)
    .where(eq(jobs.jobId, asJobId(jobId)))
    .get();

describe('cell claims', () => {
  it('hands a queued work order to a cell that allows its line', async () => {
    const { app, clock, db } = setup();

    const { status, body } = await claim(app, CELL_A);

    expect(status).toBe(200);
    expect(body.job).toMatchObject({
      kind: 'run_operator',
      orderId: 'order-1',
      workspaceMode: 'fresh',
      epoch: 1,
      leaseExpiresAt: clock.now() + LEASE_TTL_MS,
      targetBranch: 'factory/order-1',
    });
    expect(orderState(db, 'order-1')).toMatchObject({
      state: 'running',
      activeCellId: CELL_A,
      pinnedFactoryId: 'factory-1',
      activeJobId: body.job?.jobId,
    });
    expect(jobRow(db, body.job?.jobId ?? '')).toMatchObject({
      status: 'claimed',
      claimedByCellId: CELL_A,
      claimedByFactoryId: 'factory-1',
    });
  });

  it('tells the cell which line and task the claimed job runs', async () => {
    const { app } = setup();

    const { body } = await claim(app, CELL_A);

    expect(body.job?.payload).toMatchObject({
      stepIndex: 0,
      lineName: 'feature',
      task: {
        slug: 'order-1',
        title: 'order-1',
        type: 'feat',
        description: 'seeded order',
      },
    });
  });

  it('gives each queued order to one cell and leaves the extra cell empty', async () => {
    const { app } = setup();

    const results = await Promise.all(
      [CELL_A, CELL_B, CELL_C].map((cellId) => claim(app, cellId)),
    );

    const orderIds = results.map((r) => r.body.job?.orderId ?? null);
    const claimed = orderIds.filter((id) => id !== null);
    expect(claimed).toHaveLength(2);
    expect(new Set(claimed).size).toBe(2);
    expect(orderIds).toContain(null);
  });

  it('leaves a cell alone when the queued order is on a line it does not allow', async () => {
    const { app } = setup();

    const { status, body } = await claim(app, CELL_A, {
      allowedLines: ['web'],
    });

    expect(status).toBe(200);
    expect(body).toEqual({ code: 200, job: null, signals: [] });
  });

  it('does not hand a cell work from another project', async () => {
    const { app, clock, db } = setup();
    db.insert(projects)
      .values({
        projectId: asProjectId('proj-2'),
        repoUrl: 'git@example.test:acme/other.git',
        defaultBaseBranch: 'main',
        maxRunning: 5,
        createdAt: clock.now(),
        updatedAt: clock.now(),
      })
      .run();
    db.insert(workOrders)
      .values({
        orderId: asOrderId('proj-2:elsewhere'),
        projectId: asProjectId('proj-2'),
        slug: 'elsewhere',
        title: 'elsewhere',
        type: 'feat',
        description: 'other project order',
        lineName: 'feature',
        unavailableLineFactoriesJson: [],
        priority: 'high',
        baseBranch: 'main',
        branch: 'factory/elsewhere',
        state: 'queued',
        version: 1,
        createdAt: clock.now(),
        updatedAt: clock.now(),
      })
      .run();

    const results = await Promise.all(
      [CELL_A, CELL_B, CELL_C].map((cellId) => claim(app, cellId)),
    );

    const claimedOrderIds = results.map((r) => r.body.job?.orderId ?? null);
    expect(claimedOrderIds).not.toContain('proj-2:elsewhere');
    expect(claimedOrderIds).toContain(null);
  });

  it('does not hand a second job to a cell that is still working', async () => {
    const { app } = setup();
    await claim(app, CELL_A);

    const { body } = await claim(app, CELL_A);

    expect(body).toEqual({ code: 200, job: null, signals: [] });
  });

  it('refuses a claim that names no cell', async () => {
    const { app } = setup();

    const response = await postJson(
      app,
      '/api/v1/cells/claims',
      claimBody({}, PROJECT_ID),
      { authorization: `Bearer sf_factory_test-factory-token` },
    );

    expect(response.status).toBe(403);
  });

  it('refuses a claim made with a join token', async () => {
    const { app, db, clock } = setup();
    db.insert(safeTokens)
      .values({
        tokenId: asTokenId('join-1'),
        tokenHash: hashToken('sf_join_some-join'),
        prefix: TOKEN_PREFIXES.join,
        kind: 'factory_join',
        name: 'join',
        scopesJson: ['factory:enroll'],
        createdAt: clock.now(),
      })
      .run();

    const { status } = await claim(app, CELL_A, {
      token: 'sf_join_some-join',
    });

    expect(status).toBe(403);
  });

  it('answers an idle claim with no job once the wait runs out', async () => {
    const { app } = setup();

    const { status, body } = await claim(app, CELL_A, {
      allowedLines: ['web'],
      waitMs: 50,
    });

    expect(status).toBe(200);
    expect(body).toEqual({ code: 200, job: null, signals: [] });
  });

  it('wakes a parked idle claim as soon as a queue import adds work', async () => {
    const { app } = setup();

    const started = Date.now();
    const parked = claim(app, CELL_A, {
      allowedLines: ['web'],
      waitMs: LONG_WAIT_MS,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await queueImport(app, 'web-one', 'web');
    const { body } = await parked;

    expect(Date.now() - started).toBeLessThan(PROMPT_MS);
    expect(body.job).toMatchObject({ kind: 'run_operator' });
    expect(body.job?.orderId).toBe('proj-1:web-one');
  });

  it('answers at once when the waiter cap is already full', async () => {
    const { app } = setup();
    const cells = [CELL_A, CELL_B, CELL_C, CELL_D, CELL_E, CELL_F];
    const parked = cells
      .slice(0, 5)
      .map((cellId) =>
        claim(app, cellId, { allowedLines: ['web'], waitMs: LONG_WAIT_MS }),
      );
    await new Promise((resolve) => setTimeout(resolve, 20));

    const started = Date.now();
    const overflow = await claim(app, CELL_F, {
      allowedLines: ['web'],
      waitMs: LONG_WAIT_MS,
    });
    await queueImport(app, 'web-one', 'web');
    await Promise.all(parked);

    expect(Date.now() - started).toBeLessThan(PROMPT_MS);
    expect(overflow.body).toEqual({ code: 200, job: null, signals: [] });
  });

  it('re-queues the order of a silent factory once its lease expires', async () => {
    const { app, clock, db } = setup();
    seedFactory(db, 'factory-2', 'sf_factory_second-token', clock.now());
    const lost = await claim(app, CELL_A);
    clock.advance(LEASE_TTL_MS);

    const { body } = await claim(app, CELL_B, {
      token: 'sf_factory_second-token',
    });

    expect(lost.body.job?.epoch).toBe(1);
    expect(jobRow(db, lost.body.job?.jobId ?? '')?.status).toBe('lost');
    expect(body.job).toMatchObject({ orderId: 'order-1', epoch: 3 });
    expect(orderState(db, 'order-1')).toMatchObject({
      state: 'running',
      activeCellId: CELL_B,
      pinnedFactoryId: 'factory-2',
    });
  });

  it('hands out a plan branch job before any work order', async () => {
    const { app, db } = setup();
    await postJson(
      app,
      '/api/v1/order-plans',
      {
        projectId: PROJECT_ID,
        slug: 'plan-x',
        title: 'Plan X',
        activate: true,
      },
      { authorization: `Bearer ${SUPERVISOR_TOKEN}` },
    );

    const { body } = await claim(app, CELL_A);

    expect(body.job).toMatchObject({
      kind: 'plan_branch',
      orderId: null,
      planId: 'proj-1:plan-x',
    });
    expect(orderState(db, 'order-1')?.state).toBe('queued');
  });
});
