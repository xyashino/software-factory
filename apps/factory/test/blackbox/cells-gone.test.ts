import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { LEASE_TTL_MS } from '../../src/config';
import type { Db } from '../../src/db/client';
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
import { createTestApp, postJson, type TestApp } from '../support/test-app';
import { seedBaseline } from '../support/test-db';

const PROJECT_ID = 'proj-1';
const FACTORY_JOIN = 'sf_join_gone-factory-join';
const OTHER_FACTORY_JOIN = 'sf_join_gone-other-factory-join';
const CELL_JOIN = 'sf_join_gone-cell-join';

type ClaimBody = {
  code: number;
  job: null | {
    jobId: string;
    orderId: string | null;
    epoch: number;
  };
};

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

const setup = () => {
  const { app, clock, db } = createTestApp({ safeTokenAuth: true });
  seedBaseline(db);
  db.insert(safeTokens)
    .values([
      {
        tokenId: asTokenId('factory-join-gone'),
        tokenHash: hashToken(FACTORY_JOIN),
        prefix: TOKEN_PREFIXES.join,
        kind: 'factory_join',
        name: 'factory join',
        scopesJson: ['factory:enroll'],
        createdAt: clock.now(),
      },
      {
        tokenId: asTokenId('other-factory-join-gone'),
        tokenHash: hashToken(OTHER_FACTORY_JOIN),
        prefix: TOKEN_PREFIXES.join,
        kind: 'factory_join',
        name: 'other factory join',
        scopesJson: ['factory:enroll'],
        createdAt: clock.now(),
      },
      {
        tokenId: asTokenId('cell-join-gone'),
        tokenHash: hashToken(CELL_JOIN),
        prefix: TOKEN_PREFIXES.join,
        kind: 'cell_join',
        name: 'cell join',
        scopesJson: ['cell:enroll'],
        createdAt: clock.now(),
      },
    ])
    .run();
  return { app, clock, db };
};

const enrollFactory = async (
  app: TestApp,
  joinToken: string,
  name: string,
): Promise<string> => {
  const response = await postJson(
    app,
    '/api/v1/factories/enroll',
    { name },
    bearer(joinToken),
  );
  return ((await response.json()) as { sessionToken: string }).sessionToken;
};

const enrollCell = async (
  app: TestApp,
  token: string,
  name: string,
  allowedLines: string[] = ['feature'],
): Promise<string> => {
  const response = await postJson(
    app,
    '/api/v1/cells/enroll',
    { projectId: PROJECT_ID, name, allowedLines, runners: ['claude'] },
    bearer(token),
  );
  return ((await response.json()) as { sessionToken: string }).sessionToken;
};

const claim = async (app: TestApp, token: string): Promise<ClaimBody> => {
  const response = await postJson(
    app,
    '/api/v1/cells/claims',
    {},
    bearer(token),
  );
  return (await response.json()) as ClaimBody;
};

const goneCell = (app: TestApp, factorySession: string, cellId: string) =>
  postJson(
    app,
    `/api/v1/factories/cells/${encodeURIComponent(cellId)}/gone`,
    undefined,
    bearer(factorySession),
  );

const heartbeatJob = (
  app: TestApp,
  token: string,
  jobId: string,
  epoch: number,
) => postJson(app, '/api/v1/cells/heartbeats', { jobId, epoch }, bearer(token));

const heartbeatFactory = (app: TestApp, session: string) =>
  postJson(app, '/api/v1/factories/heartbeat', undefined, bearer(session));

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

const orderState = (db: Db, orderId: string) =>
  db
    .select()
    .from(workOrders)
    .where(eq(workOrders.orderId, asOrderId(orderId)))
    .get();

const tokenCountOf = (db: Db, cellId: string): number =>
  db
    .select()
    .from(safeTokens)
    .where(eq(safeTokens.cellId, asCellId(cellId)))
    .all().length;

describe('cell gone', () => {
  it('gone cell mid-job re-queues its order for another cell', async () => {
    // Arrange
    const { app, db } = setup();
    const factory = await enrollFactory(app, FACTORY_JOIN, 'laptop');
    const cellA = await enrollCell(app, factory, 'cell-a');
    await claim(app, cellA);

    // Act
    const gone = await goneCell(app, factory, 'proj-1:cell-a');
    const cellB = await enrollCell(app, CELL_JOIN, 'cell-b');
    const takeover = await claim(app, cellB);

    // Assert
    expect(gone.status).toBe(200);
    expect(orderState(db, 'order-1')).toMatchObject({
      state: 'running',
      activeCellId: 'proj-1:cell-b',
      pinnedCellId: 'proj-1:cell-b',
      epoch: 3,
    });
    expect(takeover.job).toMatchObject({ orderId: 'order-1', epoch: 3 });
  });

  it('gone cell leaves its order unpinned and queued', async () => {
    // Arrange
    const { app, db } = setup();
    const factory = await enrollFactory(app, FACTORY_JOIN, 'laptop');
    const cellA = await enrollCell(app, factory, 'cell-a');
    await claim(app, cellA);

    // Act
    await goneCell(app, factory, 'proj-1:cell-a');

    // Assert
    expect(orderState(db, 'order-1')).toMatchObject({
      state: 'queued',
      activeCellId: null,
      activeJobId: null,
      pinnedCellId: null,
      epoch: 2,
    });
  });

  it('gone cell row and tokens are deleted while its old job keeps the cell id', async () => {
    // Arrange
    const { app, db } = setup();
    const factory = await enrollFactory(app, FACTORY_JOIN, 'laptop');
    const cellA = await enrollCell(app, factory, 'cell-a');
    const lost = await claim(app, cellA);

    // Act
    await goneCell(app, factory, 'proj-1:cell-a');

    // Assert
    expect(cellRow(db, 'proj-1:cell-a')).toBeUndefined();
    expect(tokenCountOf(db, 'proj-1:cell-a')).toBe(0);
    expect(jobRow(db, lost.job?.jobId ?? '')).toMatchObject({
      status: 'lost',
      cellId: 'proj-1:cell-a',
    });
  });

  it('gone twice is safe', async () => {
    // Arrange
    const { app } = setup();
    const factory = await enrollFactory(app, FACTORY_JOIN, 'laptop');
    await enrollCell(app, factory, 'cell-a');

    // Act
    const first = await goneCell(app, factory, 'proj-1:cell-a');
    const second = await goneCell(app, factory, 'proj-1:cell-a');

    // Assert
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
  });

  it('gone for an unknown cell answers 200', async () => {
    // Arrange
    const { app } = setup();
    const factory = await enrollFactory(app, FACTORY_JOIN, 'laptop');

    // Act
    const response = await goneCell(app, factory, 'proj-1:never-existed');

    // Assert
    expect(response.status).toBe(200);
  });

  it('foreign factory cannot gone another factory cell', async () => {
    // Arrange
    const { app, db } = setup();
    const owner = await enrollFactory(app, FACTORY_JOIN, 'laptop-owner');
    const intruder = await enrollFactory(
      app,
      OTHER_FACTORY_JOIN,
      'laptop-intruder',
    );
    await enrollCell(app, owner, 'cell-a');

    // Act
    const response = await goneCell(app, intruder, 'proj-1:cell-a');

    // Assert
    expect(response.status).toBe(403);
    expect(cellRow(db, 'proj-1:cell-a')).toBeDefined();
  });

  it('factory cannot gone a cell enrolled with a join token', async () => {
    // Arrange
    const { app, db } = setup();
    const factory = await enrollFactory(app, FACTORY_JOIN, 'laptop');
    await enrollCell(app, CELL_JOIN, 'cell-joined');

    // Act
    const response = await goneCell(app, factory, 'proj-1:cell-joined');

    // Assert
    expect(response.status).toBe(403);
    expect(cellRow(db, 'proj-1:cell-joined')).toBeDefined();
  });

  it('gone does not count as a worktree reset', async () => {
    // Arrange
    const { app, db } = setup();
    const factory = await enrollFactory(app, FACTORY_JOIN, 'laptop');
    const cellA = await enrollCell(app, factory, 'cell-a');
    await claim(app, cellA);
    const resetsBefore = orderState(db, 'order-1')?.worktreeResets;

    // Act
    await goneCell(app, factory, 'proj-1:cell-a');

    // Assert
    expect(orderState(db, 'order-1')?.worktreeResets).toBe(resetsBefore);
  });

  it('gone cell cannot send a late result with its old epoch', async () => {
    // Arrange
    const { app } = setup();
    const factory = await enrollFactory(app, FACTORY_JOIN, 'laptop');
    const cellA = await enrollCell(app, factory, 'cell-a');
    const lost = await claim(app, cellA);
    await goneCell(app, factory, 'proj-1:cell-a');
    const cellB = await enrollCell(app, CELL_JOIN, 'cell-b');
    await claim(app, cellB);

    // Act
    const late = await heartbeatJob(
      app,
      cellA,
      lost.job?.jobId ?? '',
      lost.job?.epoch ?? -1,
    );

    // Assert
    expect(late.status).toBe(401);
  });

  it('live cell with an expired lease is fenced by its old epoch', async () => {
    // Arrange
    const { app, clock, db } = setup();
    const cellA = await enrollCell(app, CELL_JOIN, 'cell-a');
    const lost = await claim(app, cellA);
    clock.advance(LEASE_TTL_MS - 1_000);
    await claim(app, cellA);
    clock.advance(2_000);
    const cellB = await enrollCell(app, CELL_JOIN, 'cell-b');

    // Act
    const takeover = await claim(app, cellB);
    const late = await heartbeatJob(
      app,
      cellA,
      lost.job?.jobId ?? '',
      lost.job?.epoch ?? -1,
    );

    // Assert
    expect(takeover.job).toMatchObject({ orderId: 'order-2' });
    expect(orderState(db, 'order-1')).toMatchObject({
      state: 'queued',
      pinnedCellId: 'proj-1:cell-a',
    });
    expect(late.status).toBe(409);
    expect(cellRow(db, 'proj-1:cell-a')).toMatchObject({ status: 'online' });
  });

  it('silent factory cells are deleted at the lease expiry', async () => {
    // Arrange
    const { app, clock, db } = setup();
    const factory = await enrollFactory(app, FACTORY_JOIN, 'laptop');
    const idle = await enrollCell(app, factory, 'cell-idle', ['web']);
    await claim(app, idle);
    clock.advance(LEASE_TTL_MS / 2);
    await claim(app, idle);
    clock.advance(LEASE_TTL_MS / 2 + 1_000);

    // Act
    const cellB = await enrollCell(app, CELL_JOIN, 'cell-b');
    await claim(app, cellB);

    // Assert
    expect(cellRow(db, 'proj-1:cell-idle')).toBeUndefined();
  });

  it('idle cell of a live factory is kept while it keeps polling', async () => {
    // Arrange
    const { app, clock, db } = setup();
    const factory = await enrollFactory(app, FACTORY_JOIN, 'laptop');
    const idle = await enrollCell(app, factory, 'cell-idle', ['web']);
    await claim(app, idle);
    clock.advance(LEASE_TTL_MS / 2);
    await heartbeatFactory(app, factory);
    await claim(app, idle);
    clock.advance(LEASE_TTL_MS / 2 + 1_000);

    // Act
    await claim(app, await enrollCell(app, CELL_JOIN, 'cell-b'));

    // Assert
    expect(cellRow(db, 'proj-1:cell-idle')).toMatchObject({ status: 'online' });
  });
});
