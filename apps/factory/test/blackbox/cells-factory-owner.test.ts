import { describe, expect, it } from 'vitest';
import { safeTokens } from '../../src/db/schema/tokens';
import {
  hashToken,
  TOKEN_PREFIXES,
} from '../../src/application/tokens/token-hash';
import { asTokenId } from '../../src/domain/common/brand';
import {
  createTestApp,
  getJson,
  postJson,
  type TestApp,
} from '../support/test-app';
import { seedBaseline } from '../support/test-db';

const FACTORY_JOIN = 'sf_join_owner-factory-join';
const CELL_JOIN = 'sf_join_owner-cell-join';
const SUPERVISOR_TOKEN = 'sf_sup_owner-supervisor';
const PROJECT_ID = 'proj-1';
const CELL_NAME = 'cell-owned';
const CELL_ID = `${PROJECT_ID}:${CELL_NAME}`;

const enrollBody = {
  projectId: PROJECT_ID,
  name: CELL_NAME,
  allowedLines: ['feature'],
  runners: ['claude'],
};

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

const setup = () => {
  const { app, clock, db } = createTestApp({ safeTokenAuth: true });
  seedBaseline(db);
  db.insert(safeTokens)
    .values([
      {
        tokenId: asTokenId('factory-join-owner'),
        tokenHash: hashToken(FACTORY_JOIN),
        prefix: TOKEN_PREFIXES.join,
        kind: 'factory_join',
        name: 'factory join',
        scopesJson: ['factory:enroll'],
        createdAt: clock.now(),
      },
      {
        tokenId: asTokenId('cell-join-owner'),
        tokenHash: hashToken(CELL_JOIN),
        prefix: TOKEN_PREFIXES.join,
        kind: 'cell_join',
        name: 'cell join',
        scopesJson: ['cell:enroll'],
        createdAt: clock.now(),
      },
      {
        tokenId: asTokenId('supervisor-owner'),
        tokenHash: hashToken(SUPERVISOR_TOKEN),
        prefix: TOKEN_PREFIXES.supervisor,
        kind: 'supervisor',
        name: 'supervisor',
        scopesJson: ['supervisor:read'],
        createdAt: clock.now(),
      },
    ])
    .run();
  return { app };
};

const enrollFactory = async (
  app: TestApp,
): Promise<{ factoryId: string; sessionToken: string }> => {
  const response = await postJson(
    app,
    '/api/v1/factories/enroll',
    { name: 'laptop-owner' },
    bearer(FACTORY_JOIN),
  );
  return (await response.json()) as { factoryId: string; sessionToken: string };
};

const enrollCell = (app: TestApp, token: string): Promise<Response> =>
  postJson(app, '/api/v1/cells/enroll', enrollBody, bearer(token));

const listedCell = async (app: TestApp, cellId: string) => {
  const response = await getJson(
    app,
    '/api/v1/cells',
    bearer(SUPERVISOR_TOKEN),
  );
  const body = (await response.json()) as {
    cells: { cellId: string; factoryId: string | null }[];
  };
  return body.cells.find((cell) => cell.cellId === cellId);
};

describe('cell owner', () => {
  it('factory enrolls cell and list shows owning factory', async () => {
    const { app } = setup();
    const factory = await enrollFactory(app);

    const enrolled = await enrollCell(app, factory.sessionToken);

    expect(enrolled.status).toBe(201);
    expect(await listedCell(app, CELL_ID)).toMatchObject({
      cellId: CELL_ID,
      factoryId: factory.factoryId,
    });
  });

  it('cell join enroll leaves owner empty', async () => {
    const { app } = setup();

    const enrolled = await enrollCell(app, CELL_JOIN);

    expect(enrolled.status).toBe(201);
    expect(await listedCell(app, CELL_ID)).toMatchObject({
      cellId: CELL_ID,
      factoryId: null,
    });
  });

  it('factory token cannot call other cell routes', async () => {
    const { app } = setup();
    const factory = await enrollFactory(app);
    await enrollCell(app, factory.sessionToken);

    const claim = await postJson(
      app,
      '/api/v1/cells/claims',
      {},
      bearer(factory.sessionToken),
    );

    expect(claim.status).toBe(403);
  });
});
