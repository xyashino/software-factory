import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { CELL_SESSION_TTL_MS, LEASE_TTL_MS } from '../../src/config';
import { cells } from '../../src/db/schema/cells';
import { jobs } from '../../src/db/schema/jobs';
import { safeTokens } from '../../src/db/schema/tokens';
import {
  hashToken,
  TOKEN_PREFIXES,
} from '../../src/application/tokens/token-hash';
import { asCellId, asJobId, asTokenId } from '../../src/domain/common/brand';
import { createTestApp, postJson, type TestApp } from '../support/test-app';
import { insertJob, seedBaseline } from '../support/test-db';
import type { Db } from '../../src/db/client';

const JOIN_TOKEN = 'sf_join_test-join-token';
const PROJECT_ID = 'proj-1';
const CELL_NAME = 'cell-a';
const CELL_ID = `${PROJECT_ID}:${CELL_NAME}`;
const JOB_ID = 'job-1';

const enrollBody = {
  projectId: PROJECT_ID,
  name: CELL_NAME,
  allowedLines: ['feature'],
  runners: ['claude'],
};

const helloBody = {
  projectId: PROJECT_ID,
  allowedLines: ['feature'],
  runners: ['claude'],
  localWorktrees: [],
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
  return { app, clock, db };
};

const enroll = async (
  app: TestApp,
  token: string = JOIN_TOKEN,
): Promise<Response> =>
  postJson(app, '/api/v1/cells/enroll', enrollBody, bearer(token));

const enrolledSessionToken = async (app: TestApp): Promise<string> => {
  const body = (await (await enroll(app)).json()) as { sessionToken: string };
  return body.sessionToken;
};

const hello = (app: TestApp, token: string): Promise<Response> =>
  postJson(app, '/api/v1/cells/hello', helloBody, bearer(token));

const workingOn = (db: Db, leaseExpiresAt: number): void => {
  insertJob(db, JOB_ID, 'order-1', CELL_ID, 'running');
  db.update(jobs)
    .set({ leaseExpiresAt })
    .where(eq(jobs.jobId, asJobId(JOB_ID)))
    .run();
  db.update(cells)
    .set({ activeJobId: asJobId(JOB_ID) })
    .where(eq(cells.cellId, asCellId(CELL_ID)))
    .run();
};

const jobEpoch = (db: Db): number | undefined =>
  db
    .select()
    .from(jobs)
    .where(eq(jobs.jobId, asJobId(JOB_ID)))
    .get()?.epoch;

describe('cell enrollment', () => {
  it('enrolls a cell with a join token and returns a session token', async () => {
    const { app, clock } = setup();

    const response = await enroll(app);

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      code: 201,
      cellId: CELL_ID,
      sessionToken: expect.stringMatching(/^sf_cell_/),
      expiresAt: clock.now() + CELL_SESSION_TTL_MS,
    });
  });

  it('rejects an unknown join token and writes no cell', async () => {
    const { app, db } = setup();

    const response = await enroll(app, 'sf_join_unknown');

    expect(response.status).toBe(401);
    expect(
      db
        .select()
        .from(cells)
        .all()
        .map((row) => row.cellId),
    ).not.toContain(CELL_ID);
  });

  it('rejects enrollment into a project that does not exist', async () => {
    const { app } = setup();

    const response = await postJson(
      app,
      '/api/v1/cells/enroll',
      { ...enrollBody, projectId: 'missing-project' },
      bearer(JOIN_TOKEN),
    );

    expect(response.status).toBe(404);
  });

  it('refuses a session token where a join token is required', async () => {
    const { app } = setup();
    const sessionToken = await enrolledSessionToken(app);

    const response = await enroll(app, sessionToken);

    expect(response.status).toBe(403);
  });

  it('keeps the same cell when it enrolls again', async () => {
    const { app } = setup();
    await enroll(app);

    const response = await enroll(app);

    expect(await response.json()).toMatchObject({ code: 201, cellId: CELL_ID });
  });
});

describe('cell hello and fast reconnect', () => {
  it('resumes the active job with a bumped epoch after a reconnect', async () => {
    const { app, clock, db } = setup();
    const sessionToken = await enrolledSessionToken(app);
    workingOn(db, clock.now() + LEASE_TTL_MS);
    clock.advance(10_000);

    const response = await hello(app, sessionToken);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      code: 200,
      cellId: CELL_ID,
      resumedJob: {
        jobId: JOB_ID,
        epoch: 1,
        leaseExpiresAt: clock.now() + LEASE_TTL_MS,
      },
    });
    expect(jobEpoch(db)).toBe(1);
  });

  it('says nothing to resume when the cell has no active job', async () => {
    const { app } = setup();
    const sessionToken = await enrolledSessionToken(app);

    const response = await hello(app, sessionToken);

    expect(await response.json()).toEqual({ code: 200, cellId: CELL_ID });
  });

  it('does not resume a job whose lease has already expired', async () => {
    const { app, clock, db } = setup();
    const sessionToken = await enrolledSessionToken(app);
    workingOn(db, clock.now() + LEASE_TTL_MS);
    clock.advance(LEASE_TTL_MS);

    const response = await hello(app, sessionToken);

    expect(await response.json()).toEqual({ code: 200, cellId: CELL_ID });
    expect(jobEpoch(db)).toBe(0);
  });

  it('refuses hello made with a join token', async () => {
    const { app } = setup();

    const response = await hello(app, JOIN_TOKEN);

    expect(response.status).toBe(403);
  });
});
