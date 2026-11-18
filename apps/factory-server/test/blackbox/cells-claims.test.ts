import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { LEASE_TTL_MS } from '../../src/config';
import { cells } from '../../src/db/schema/cells';
import { jobs } from '../../src/db/schema/jobs';
import { workOrders } from '../../src/db/schema/orders';
import { projects } from '../../src/db/schema/projects';
import { safeTokens } from '../../src/db/schema/tokens';
import {
  hashToken,
  TOKEN_PREFIXES,
} from '../../src/application/tokens/token-hash';
import {
  asCellId,
  asJobId,
  asOrderId,
  asProjectId,
  asTokenId,
} from '../../src/domain/common/brand';
import { createTestApp, postJson, type TestApp } from '../support/test-app';
import { seedBaseline } from '../support/test-db';
import type { Db } from '../../src/db/client';

const PROJECT_ID = 'proj-1';
const JOIN_TOKEN = 'sf_join_test-join-token';
const SUPERVISOR_TOKEN = 'supervisor-test-token';
const LONG_WAIT_MS = 5_000;
const PROMPT_MS = 1_000;

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
      scopesJson: ['supervisor:write'],
      createdAt: clock.now(),
    })
    .run();
  return { app, clock, db };
};

const enrollCell = async (
  app: TestApp,
  name: string,
  allowedLines: string[] = ['feature'],
): Promise<string> => {
  const response = await postJson(
    app,
    '/api/v1/cells/enroll',
    { projectId: PROJECT_ID, name, allowedLines, runners: ['claude'] },
    bearer(JOIN_TOKEN),
  );
  const body = (await response.json()) as { sessionToken: string };
  return body.sessionToken;
};

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
  };
};

const claim = async (
  app: TestApp,
  token: string,
  waitMs?: number,
): Promise<{ status: number; body: ClaimBody }> => {
  const response = await postJson(
    app,
    '/api/v1/cells/claims',
    waitMs === undefined ? {} : { waitMs },
    bearer(token),
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
    bearer(SUPERVISOR_TOKEN),
  );

const orderState = (db: Db, orderId: string) =>
  db
    .select()
    .from(workOrders)
    .where(eq(workOrders.orderId, asOrderId(orderId)))
    .get();

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

describe('cell claims', () => {
  it('hands a queued work order to a cell that allows its line', async () => {
    const { app, clock, db } = setup();
    const token = await enrollCell(app, 'cell-a');

    const { status, body } = await claim(app, token);

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
      activeCellId: 'proj-1:cell-a',
      pinnedCellId: 'proj-1:cell-a',
      activeJobId: body.job?.jobId,
    });
    expect(jobRow(db, body.job?.jobId ?? '')).toMatchObject({
      status: 'claimed',
      cellId: 'proj-1:cell-a',
    });
  });

  it('gives each queued order to one cell and leaves the extra cell empty', async () => {
    const { app } = setup();
    const tokens = await Promise.all([
      enrollCell(app, 'cell-a'),
      enrollCell(app, 'cell-b'),
      enrollCell(app, 'cell-c'),
    ]);

    const results = await Promise.all(tokens.map((token) => claim(app, token)));

    const orderIds = results.map((r) => r.body.job?.orderId ?? null);
    const claimed = orderIds.filter((id) => id !== null);
    expect(claimed).toHaveLength(2);
    expect(new Set(claimed).size).toBe(2);
    expect(orderIds).toContain(null);
  });

  it('leaves a cell alone when the queued order is on a line it does not allow', async () => {
    const { app } = setup();
    const token = await enrollCell(app, 'cell-a', ['web']);

    const { status, body } = await claim(app, token);

    expect(status).toBe(200);
    expect(body).toEqual({ code: 200, job: null });
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
        unavailableLineCellsJson: [],
        priority: 'high',
        baseBranch: 'main',
        branch: 'factory/elsewhere',
        state: 'queued',
        version: 1,
        createdAt: clock.now(),
        updatedAt: clock.now(),
      })
      .run();
    const tokens = await Promise.all([
      enrollCell(app, 'cell-a'),
      enrollCell(app, 'cell-b'),
      enrollCell(app, 'cell-c'),
    ]);

    const results = await Promise.all(tokens.map((token) => claim(app, token)));

    const claimedOrderIds = results.map((r) => r.body.job?.orderId ?? null);
    expect(claimedOrderIds).not.toContain('proj-2:elsewhere');
    expect(claimedOrderIds).toContain(null);
  });

  it('does not hand a second job to a cell that is still working', async () => {
    const { app } = setup();
    const token = await enrollCell(app, 'cell-a');
    await claim(app, token);

    const { body } = await claim(app, token);

    expect(body).toEqual({ code: 200, job: null });
  });

  it('refuses a claim from a revoked cell', async () => {
    const { app, db } = setup();
    const token = await enrollCell(app, 'cell-a');
    db.update(cells)
      .set({ status: 'revoked' })
      .where(eq(cells.cellId, asCellId('proj-1:cell-a')))
      .run();

    const { status } = await claim(app, token);

    expect(status).toBe(403);
  });

  it('refuses a claim made with a join token', async () => {
    const { app } = setup();

    const { status } = await claim(app, JOIN_TOKEN);

    expect(status).toBe(403);
  });

  it('answers an idle claim with no job once the wait runs out', async () => {
    const { app } = setup();
    const token = await enrollCell(app, 'cell-a', ['web']);

    const { status, body } = await claim(app, token, 50);

    expect(status).toBe(200);
    expect(body).toEqual({ code: 200, job: null });
  });

  it('wakes a parked idle claim as soon as a queue import adds work', async () => {
    const { app } = setup();
    const token = await enrollCell(app, 'cell-a', ['web']);

    const started = Date.now();
    const parked = claim(app, token, LONG_WAIT_MS);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await queueImport(app, 'web-one', 'web');
    const { body } = await parked;

    expect(Date.now() - started).toBeLessThan(PROMPT_MS);
    expect(body.job).toMatchObject({ kind: 'run_operator' });
    expect(body.job?.orderId).toBe('proj-1:web-one');
  });

  it('answers at once when the waiter cap is already full', async () => {
    const { app } = setup();
    const tokens = await Promise.all(
      ['cell-a', 'cell-b', 'cell-c', 'cell-d', 'cell-e', 'cell-f'].map((name) =>
        enrollCell(app, name, ['web']),
      ),
    );
    const parked = tokens
      .slice(0, 5)
      .map((token) => claim(app, token, LONG_WAIT_MS));
    await new Promise((resolve) => setTimeout(resolve, 20));

    const started = Date.now();
    const overflow = await claim(app, tokens[5] ?? '', LONG_WAIT_MS);
    await queueImport(app, 'web-one', 'web');
    await Promise.all(parked);

    expect(Date.now() - started).toBeLessThan(PROMPT_MS);
    expect(overflow.body).toEqual({ code: 200, job: null });
  });

  it('takes a silent cell offline and re-queues its order when the lease expires', async () => {
    const { app, clock, db } = setup();
    const lostToken = await enrollCell(app, 'cell-a');
    await helloCell(app, lostToken);
    const lost = await claim(app, lostToken);
    clock.advance(LEASE_TTL_MS);
    const nextToken = await enrollCell(app, 'cell-b');

    const { body } = await claim(app, nextToken);

    expect(lost.body.job?.epoch).toBe(1);
    expect(jobRow(db, lost.body.job?.jobId ?? '')?.status).toBe('lost');
    expect(cellRow(db, 'proj-1:cell-a')?.status).toBe('offline');
    expect(body.job).toMatchObject({ orderId: 'order-1', epoch: 3 });
    expect(orderState(db, 'order-1')).toMatchObject({
      state: 'running',
      activeCellId: 'proj-1:cell-b',
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
      bearer(SUPERVISOR_TOKEN),
    );
    const token = await enrollCell(app, 'cell-a');

    const { body } = await claim(app, token);

    expect(body.job).toMatchObject({
      kind: 'plan_branch',
      orderId: null,
      planId: 'proj-1:plan-x',
    });
    expect(orderState(db, 'order-1')?.state).toBe('queued');
  });
});
