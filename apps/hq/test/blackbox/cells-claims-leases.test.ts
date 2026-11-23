import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { LEASE_TTL_MS } from '../../src/config';
import { jobs } from '../../src/db/schema/jobs';
import { workOrders } from '../../src/db/schema/orders';
import { safeTokens } from '../../src/db/schema/tokens';
import { hashToken } from '../../src/application/tokens/token-hash';
import { asJobId, asOrderId, asTokenId } from '../../src/domain/common/brand';
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
const OPERATOR_TOKEN = 'operator-test-token';
const LONG_WAIT_MS = 5_000;
const CELL_A = 'cell-aaaaaaaa';
const CELL_B = 'cell-bbbbbbbb';
const SECOND_FACTORY_TOKEN = 'sf_factory_second-token';

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

const setup = () => {
  const { app, clock, db } = createTestApp({ safeTokenAuth: true });
  seedBaseline(db);
  seedFactory(db, 'factory-2', SECOND_FACTORY_TOKEN, clock.now());
  db.insert(safeTokens)
    .values({
      tokenId: asTokenId('operator-1'),
      tokenHash: hashToken(OPERATOR_TOKEN),
      prefix: 'sf_sup_',
      kind: 'operator',
      name: 'operator',
      scopesJson: ['operator:read', 'operator:write'],
      createdAt: clock.now(),
    })
    .run();
  return { app, clock, db };
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

const heartbeat = async (
  app: TestApp,
  cellId: string,
  jobId: string,
  epoch: number,
  token: string = FACTORY_TOKEN,
): Promise<{ status: number; body: HeartbeatBody | ErrorBody }> => {
  const response = await postJson(
    app,
    '/api/v1/cells/heartbeats',
    { jobId, epoch },
    factoryHeaders(cellId, token),
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
    { authorization: `Bearer ${OPERATOR_TOKEN}` },
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
    { authorization: `Bearer ${OPERATOR_TOKEN}` },
  );

const jobRow = (db: Db, jobId: string) =>
  db
    .select()
    .from(jobs)
    .where(eq(jobs.jobId, asJobId(jobId)))
    .get();

describe('cell heartbeats', () => {
  it('extends the lease when the heartbeat carries the current epoch', async () => {
    const { app, clock, db } = setup();
    const { body: claimed } = await claim(app, CELL_A);
    const job = claimed.job;
    clock.advance(10_000);

    const { status, body } = await heartbeat(
      app,
      CELL_A,
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
    const { body: claimed } = await claim(app, CELL_A);

    const { status, body } = await heartbeat(
      app,
      CELL_A,
      claimed.job?.jobId ?? '',
      (claimed.job?.epoch ?? 0) - 1,
    );

    expect(status).toBe(409);
    expect(body).toMatchObject({ type: 'stale-lease-epoch' });
  });

  it('refuses a heartbeat for a job that another cell holds', async () => {
    const { app } = setup();
    const { body: claimed } = await claim(app, CELL_A);

    const { status, body } = await heartbeat(
      app,
      CELL_B,
      claimed.job?.jobId ?? '',
      claimed.job?.epoch ?? -1,
    );

    expect(status).toBe(409);
    expect(body).toMatchObject({ type: 'stale-lease-epoch' });
  });

  it('tells the cell to abort when its order is paused under it', async () => {
    const { app, db } = setup();
    const { body: claimed } = await claim(app, CELL_A);
    db.update(workOrders)
      .set({ state: 'paused' })
      .where(eq(workOrders.orderId, asOrderId('order-1')))
      .run();

    const { body } = await heartbeat(
      app,
      CELL_A,
      claimed.job?.jobId ?? '',
      claimed.job?.epoch ?? -1,
    );

    expect(body).toMatchObject({ code: 200, signals: ['abort'] });
  });

  it('tells the cell to abort when its order is cancelled under it', async () => {
    const { app } = setup();
    const { body: claimed } = await claim(app, CELL_A);
    const transition = await transitionOrder(app, 'order-1', 'cancel');

    const { status, body } = await heartbeat(
      app,
      CELL_A,
      claimed.job?.jobId ?? '',
      claimed.job?.epoch ?? -1,
    );

    expect(transition.status).toBe(200);
    expect(status).toBe(200);
    expect(body).toMatchObject({ code: 200, signals: ['abort'] });
  });

  it('refuses a heartbeat sent with a Cell token instead of a Factory token', async () => {
    const { app } = setup();
    const { body: claimed } = await claim(app, CELL_A);

    const response = await postJson(
      app,
      '/api/v1/cells/heartbeats',
      {
        jobId: claimed.job?.jobId ?? '',
        epoch: claimed.job?.epoch ?? -1,
      },
      { authorization: `Bearer ${OPERATOR_TOKEN}`, 'x-cell-id': CELL_A },
    );

    expect(response.status).toBe(403);
  });
});

describe('lease expiry handover', () => {
  it('hands an expired lease to another factory and refuses the silent cell late', async () => {
    const { app, clock, db } = setup();
    const parked = claim(app, CELL_A, {
      allowedLines: ['web'],
      waitMs: LONG_WAIT_MS,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await queueImport(app, 'web-one', 'web');
    const { body: claimed } = await parked;
    const jobId = claimed.job?.jobId ?? '';

    clock.advance(30_000);
    const beat = await heartbeat(app, CELL_A, jobId, 1);
    clock.advance(LEASE_TTL_MS + 1);
    const takeover = await claim(app, CELL_B, {
      allowedLines: ['web'],
      token: SECOND_FACTORY_TOKEN,
    });
    const late = await heartbeat(app, CELL_A, jobId, 1);

    expect(claimed.job).toMatchObject({ orderId: 'proj-1:web-one', epoch: 1 });
    expect(beat.body).toMatchObject({ code: 200, signals: [] });
    expect(takeover.body.job).toMatchObject({ orderId: 'proj-1:web-one' });
    expect(jobRow(db, jobId)?.status).toBe('lost');
    expect(late.status).toBe(409);
  });
});
