import { describe, expect, it } from 'vitest';
import { mintAdminToken } from '../../src/bootstrap/admin';
import { TOKEN_ROTATE_GRACE_MS } from '../../src/config';
import {
  createTestApp,
  deleteJson,
  getJson,
  postJson,
  type TestApp,
} from '../support/test-app';
import type { FakeClock } from '../support/test-transport';

type TokenBody = { code: number; tokenId: string; token: string };

const PROJECT = {
  projectId: 'factory',
  repoUrl: 'git@example.test:acme/factory.git',
  defaultBaseBranch: 'main',
};

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

const setup = () => {
  const context = createTestApp({ safeTokenAuth: true });
  const admin = mintAdminToken(context.db, context.clock);
  return { ...context, admin };
};

const issueToken = async (
  app: TestApp,
  admin: string,
  kind: 'supervisor' | 'factory_join',
): Promise<TokenBody> => {
  const response = await postJson(
    app,
    '/api/v1/tokens',
    { kind, name: `${kind} token` },
    bearer(admin),
  );
  return (await response.json()) as TokenBody;
};

const expectRotation = async (
  app: TestApp,
  token: string,
): Promise<TokenBody> => {
  const response = await postJson(
    app,
    '/api/v1/tokens/rotate',
    {},
    bearer(token),
  );
  return (await response.json()) as TokenBody;
};

const advancePastGrace = (clock: FakeClock): void => {
  clock.advance(TOKEN_ROTATE_GRACE_MS + 1);
};

describe('token issuance', () => {
  it('issues a token once and lets it authenticate', async () => {
    const { app, admin } = setup();

    const issued = await issueToken(app, admin, 'supervisor');
    const response = await getJson(
      app,
      '/api/v1/projects',
      bearer(issued.token),
    );

    expect(issued).toMatchObject({
      code: 201,
      token: expect.stringMatching(/^sf_sup_/),
    });
    expect(response.status).toBe(200);
  });

  it('answers 403 when the caller lacks admin:tokens', async () => {
    const { app, admin } = setup();
    const joinToken = await issueToken(app, admin, 'factory_join');

    const response = await postJson(
      app,
      '/api/v1/tokens',
      { kind: 'supervisor', name: 'nope' },
      bearer(joinToken.token),
    );

    expect(response.status).toBe(403);
  });
});

describe('token rotation', () => {
  it('keeps the old token valid during the grace window only', async () => {
    const { app, admin, clock } = setup();
    const supervisor = await issueToken(app, admin, 'supervisor');

    const rotated = await expectRotation(app, supervisor.token);
    const oldDuringGrace = await getJson(
      app,
      '/api/v1/projects',
      bearer(supervisor.token),
    );
    advancePastGrace(clock);
    const oldAfterGrace = await getJson(
      app,
      '/api/v1/projects',
      bearer(supervisor.token),
    );
    const fresh = await getJson(app, '/api/v1/projects', bearer(rotated.token));

    expect(oldDuringGrace.status).toBe(200);
    expect(oldAfterGrace.status).toBe(401);
    expect(fresh.status).toBe(200);
  });

  it('answers 409 when the same token is rotated twice', async () => {
    const { app, admin } = setup();
    const supervisor = await issueToken(app, admin, 'supervisor');
    await expectRotation(app, supervisor.token);

    const second = await postJson(
      app,
      '/api/v1/tokens/rotate',
      {},
      bearer(supervisor.token),
    );

    expect(second.status).toBe(409);
  });
});

describe('token revocation', () => {
  it('revokes a token immediately', async () => {
    const { app, admin } = setup();
    const supervisor = await issueToken(app, admin, 'supervisor');

    const revoked = await deleteJson(
      app,
      `/api/v1/tokens/${supervisor.tokenId}`,
      bearer(admin),
    );
    const after = await getJson(
      app,
      '/api/v1/projects',
      bearer(supervisor.token),
    );

    expect(revoked.status).toBe(200);
    expect(after.status).toBe(401);
  });

  it('answers 404 when revoking an unknown token', async () => {
    const { app, admin } = setup();

    const response = await deleteJson(
      app,
      '/api/v1/tokens/missing',
      bearer(admin),
    );

    expect(response.status).toBe(404);
  });
});

describe('project registration', () => {
  it('creates a project then updates it on the same projectId', async () => {
    const { app, admin } = setup();

    const created = await postJson(
      app,
      '/api/v1/projects',
      PROJECT,
      bearer(admin),
    );
    const updated = await postJson(
      app,
      '/api/v1/projects',
      { ...PROJECT, defaultBaseBranch: 'develop' },
      bearer(admin),
    );

    expect(created.status).toBe(201);
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({
      code: 200,
      project: {
        projectId: 'factory',
        defaultBaseBranch: 'develop',
        maxRunning: 5,
      },
    });
  });

  it('lists registered projects in projectId order', async () => {
    const { app, admin } = setup();
    await postJson(
      app,
      '/api/v1/projects',
      { ...PROJECT, projectId: 'zeta' },
      bearer(admin),
    );
    await postJson(
      app,
      '/api/v1/projects',
      { ...PROJECT, projectId: 'alpha' },
      bearer(admin),
    );

    const response = await getJson(app, '/api/v1/projects', bearer(admin));

    expect(await response.json()).toMatchObject({
      code: 200,
      projects: [{ projectId: 'alpha' }, { projectId: 'zeta' }],
    });
  });

  it('answers 401 when registering without a bearer token', async () => {
    const { app } = setup();

    const response = await postJson(app, '/api/v1/projects', PROJECT);

    expect(response.status).toBe(401);
  });
});
