import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { LEASE_TTL_MS } from '../../src/config';
import { cells } from '../../src/db/schema/cells';
import { jobs } from '../../src/db/schema/jobs';
import { workOrders } from '../../src/db/schema/orders';
import { safeTokens } from '../../src/db/schema/tokens';
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
import {
  createTestApp,
  deleteJson,
  getJson,
  postJson,
  type TestApp,
} from '../support/test-app';
import { seedBaseline } from '../support/test-db';

const PROJECT_ID = 'proj-1';
const JOIN_TOKEN = 'sf_join_test-join-token';
const SUPERVISOR_TOKEN = 'supervisor-test-token';
const LONG_WAIT_MS = 5_000;

type ErrorBody = { code: number; type: string };

type HeartbeatBody = {
  code: number;
  leaseExpiresAt: number | null;
  signals: string[];
};

type ClaimBody = {
  code: number;
  job: null | {
    jobId: string;
    orderId: string | null;
    epoch: number;
    leaseExpiresAt: number;
  };
};

type ResumeBody = {
  code: number;
  resumedJob?: { jobId: string; epoch: number; leaseExpiresAt: number };
};

type CellsBody = {
  code: number;
  cells: {
    cellId: string;
    status: string;
    activeJobId: string | null;
    leaseExpiresAt: number | null;
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

const helloCell = async (
  app: TestApp,
  token: string,
  allowedLines: string[] = ['feature'],
): Promise<ResumeBody> => {
  const response = await postJson(
    app,
    '/api/v1/cells/hello',
    {
      projectId: PROJECT_ID,
      allowedLines,
      runners: ['claude'],
      localWorktrees: [],
    },
    bearer(token),
  );
  return (await response.json()) as ResumeBody;
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

const heartbeat = async (
  app: TestApp,
  token: string,
  jobId: string,
  epoch: number,
): Promise<{ status: number; body: HeartbeatBody | ErrorBody }> => {
  const response = await postJson(
    app,
    '/api/v1/cells/heartbeats',
    { jobId, epoch },
    bearer(token),
  );
  return {
    status: response.status,
    body: (await response.json()) as HeartbeatBody | ErrorBody,
  };
};

const transitionOrder = (app: TestApp, orderId: string, action: string) =>
  postJson(
    app,
    `/api/v1/work-orders/${orderId}/transitions`,
    { action },
    bearer(SUPERVISOR_TOKEN),
  );

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

describe('cell heartbeats', () => {
  it('extends the lease when the heartbeat carries the current epoch', async () => {
    const { app, clock, db } = setup();
    const token = await enrollCell(app, 'cell-a');
    const { body: claimed } = await claim(app, token);
    const job = claimed.job;
    clock.advance(10_000);

    const { status, body } = await heartbeat(
      app,
      token,
      job?.jobId ?? '',
      job?.epoch ?? -1,
    );

    expect(status).toBe(200);
    expect(body).toMatchObject({
      code: 200,
      leaseExpiresAt: clock.now() + LEASE_TTL_MS,
      signals: [],
    });
    expect(jobRow(db, job?.jobId ?? '')?.leaseExpiresAt).toBe(
      clock.now() + LEASE_TTL_MS,
    );
  });

  it('refuses a heartbeat whose epoch is stale', async () => {
    const { app } = setup();
    const token = await enrollCell(app, 'cell-a');
    const { body: claimed } = await claim(app, token);

    const { status, body } = await heartbeat(
      app,
      token,
      claimed.job?.jobId ?? '',
      (claimed.job?.epoch ?? 0) - 1,
    );

    expect(status).toBe(409);
    expect(body).toMatchObject({ type: 'stale-lease-epoch' });
  });

  it('refuses a heartbeat for a job that the cell does not hold', async () => {
    const { app } = setup();
    const holder = await enrollCell(app, 'cell-a');
    const other = await enrollCell(app, 'cell-b');
    const { body: claimed } = await claim(app, holder);

    const { status, body } = await heartbeat(
      app,
      other,
      claimed.job?.jobId ?? '',
      claimed.job?.epoch ?? -1,
    );

    expect(status).toBe(409);
    expect(body).toMatchObject({ type: 'stale-lease-epoch' });
  });

  it('tells the cell to abort when its order is paused under it', async () => {
    const { app, db } = setup();
    const token = await enrollCell(app, 'cell-a');
    const { body: claimed } = await claim(app, token);
    db.update(workOrders)
      .set({ state: 'paused' })
      .where(eq(workOrders.orderId, asOrderId('order-1')))
      .run();

    const { body } = await heartbeat(
      app,
      token,
      claimed.job?.jobId ?? '',
      claimed.job?.epoch ?? -1,
    );

    expect(body).toMatchObject({ code: 200, signals: ['abort'] });
  });

  it('tells the cell to abort when its order is cancelled under it', async () => {
    const { app } = setup();
    const token = await enrollCell(app, 'cell-a');
    const { body: claimed } = await claim(app, token);
    const transition = await transitionOrder(app, 'order-1', 'cancel');

    const { status, body } = await heartbeat(
      app,
      token,
      claimed.job?.jobId ?? '',
      claimed.job?.epoch ?? -1,
    );

    expect(transition.status).toBe(200);
    expect(status).toBe(200);
    expect(body).toMatchObject({ code: 200, signals: ['abort'] });
  });
});

describe('cell list', () => {
  it('lists each cell with its status and active lease', async () => {
    const { app, clock } = setup();
    const token = await enrollCell(app, 'cell-a');
    const { body: claimed } = await claim(app, token);

    const response = await getJson(
      app,
      '/api/v1/cells',
      bearer(SUPERVISOR_TOKEN),
    );
    const body = (await response.json()) as CellsBody;

    expect(response.status).toBe(200);
    expect(body.cells).toContainEqual(
      expect.objectContaining({
        cellId: 'proj-1:cell-a',
        status: 'busy',
        activeJobId: claimed.job?.jobId,
        leaseExpiresAt: clock.now() + LEASE_TTL_MS,
      }),
    );
  });

  it('refuses the cell list to a cell token', async () => {
    const { app } = setup();
    const token = await enrollCell(app, 'cell-a');

    const response = await getJson(app, '/api/v1/cells', bearer(token));

    expect(response.status).toBe(403);
  });
});

describe('cell revoke', () => {
  it('frees the order and its pin when the cell is revoked', async () => {
    const { app, db } = setup();
    const token = await enrollCell(app, 'cell-a');
    const { body: claimed } = await claim(app, token);

    const response = await deleteJson(
      app,
      '/api/v1/cells/proj-1:cell-a',
      bearer(SUPERVISOR_TOKEN),
    );

    expect(response.status).toBe(200);
    expect(orderState(db, 'order-1')).toMatchObject({
      state: 'queued',
      activeJobId: null,
      activeCellId: null,
      pinnedCellId: null,
    });
    expect(jobRow(db, claimed.job?.jobId ?? '')?.status).toBe('lost');
    expect(cellRow(db, 'proj-1:cell-a')).toMatchObject({
      status: 'revoked',
      activeJobId: null,
    });
  });

  it('hands the freed order to another cell after the revoke', async () => {
    const { app } = setup();
    const revoked = await enrollCell(app, 'cell-a');
    await claim(app, revoked);
    await deleteJson(
      app,
      '/api/v1/cells/proj-1:cell-a',
      bearer(SUPERVISOR_TOKEN),
    );
    const next = await enrollCell(app, 'cell-b');

    const { body } = await claim(app, next);

    expect(body.job).toMatchObject({ orderId: 'order-1' });
  });

  it('refuses a claim from the revoked cell session', async () => {
    const { app } = setup();
    const token = await enrollCell(app, 'cell-a');
    await deleteJson(
      app,
      '/api/v1/cells/proj-1:cell-a',
      bearer(SUPERVISOR_TOKEN),
    );

    const { status } = await claim(app, token);

    expect(status).toBe(401);
  });

  it('refuses a heartbeat from the revoked cell session', async () => {
    const { app } = setup();
    const token = await enrollCell(app, 'cell-a');
    const { body: claimed } = await claim(app, token);
    await deleteJson(
      app,
      '/api/v1/cells/proj-1:cell-a',
      bearer(SUPERVISOR_TOKEN),
    );

    const { status } = await heartbeat(
      app,
      token,
      claimed.job?.jobId ?? '',
      claimed.job?.epoch ?? -1,
    );

    expect(status).toBe(401);
  });
});

describe('lease expiry handover', () => {
  it('hands an expired lease to another cell and deletes the silent cell', async () => {
    const { app, clock, db } = setup();
    const tokenA = await enrollCell(app, 'cell-a', ['web']);
    const parked = claim(app, tokenA, LONG_WAIT_MS);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await queueImport(app, 'web-one', 'web');
    const { body: claimed } = await parked;
    const jobId = claimed.job?.jobId ?? '';

    clock.advance(30_000);
    const beat = await heartbeat(app, tokenA, jobId, 1);
    const resumed = await helloCell(app, tokenA, ['web']);
    clock.advance(LEASE_TTL_MS + 1);
    const tokenB = await enrollCell(app, 'cell-b', ['web']);
    const takeover = await claim(app, tokenB);
    const late = await heartbeat(
      app,
      tokenA,
      jobId,
      resumed.resumedJob?.epoch ?? -1,
    );

    expect(claimed.job).toMatchObject({ orderId: 'proj-1:web-one', epoch: 1 });
    expect(beat.body).toMatchObject({ code: 200, signals: [] });
    expect(resumed.resumedJob).toMatchObject({ jobId, epoch: 2 });
    expect(takeover.body.job).toMatchObject({ orderId: 'proj-1:web-one' });
    expect(jobRow(db, jobId)?.status).toBe('lost');
    expect(cellRow(db, 'proj-1:cell-a')).toBeUndefined();
    expect(late.status).toBe(401);
  });
});
