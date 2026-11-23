import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mintAdminToken } from '../../src/bootstrap/admin';
import { writeWebJoinFile } from '../../src/bootstrap/web-join';
import {
  createTestApp,
  getJson,
  postJson,
  type TestApp,
} from '../support/test-app';

const PROJECT = {
  projectId: 'factory',
  repoUrl: 'git@example.test:acme/factory.git',
  defaultBaseBranch: 'main',
};

const LOOPBACK = '127.0.0.1';
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

const setup = () => {
  const context = createTestApp({ safeTokenAuth: true });
  const admin = mintAdminToken(context.db, context.clock);
  const dataDir = mkdtempSync(join(tmpdir(), 'web-join-'));
  writeWebJoinFile(context.db, context.clock, dataDir);
  const joinSecret = readFileSync(join(dataDir, 'web-demo.join'), 'utf8');
  return { ...context, admin, dataDir, joinSecret };
};

const joinFrom = (
  app: TestApp,
  joinSecret: string,
  remoteAddress: string = LOOPBACK,
): Promise<Response> =>
  Promise.resolve(
    app.request(
      '/api/v1/tokens/join',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ joinSecret }),
      },
      { remoteAddress },
    ),
  );

const joinSession = async (app: TestApp, joinSecret: string) => {
  const response = await joinFrom(app, joinSecret);
  return (await response.json()) as { code: number; token: string };
};

describe('web demo join', () => {
  it('gives a session that reads and writes work orders but cannot mint tokens', async () => {
    const { app, admin, joinSecret } = setup();
    await postJson(app, '/api/v1/projects', PROJECT, bearer(admin));
    const session = await joinSession(app, joinSecret);

    const factories = await getJson(
      app,
      '/api/v1/factories',
      bearer(session.token),
    );
    const created = await postJson(
      app,
      '/api/v1/work-orders',
      {
        projectId: PROJECT.projectId,
        slug: 'pay-api',
        title: 'Add API',
        type: 'feat',
        lineName: 'feature',
      },
      bearer(session.token),
    );
    const minted = await postJson(
      app,
      '/api/v1/tokens',
      { kind: 'supervisor', name: 'escalate' },
      bearer(session.token),
    );

    expect(session.code).toBe(201);
    expect(factories.status).toBe(200);
    expect(created.status).toBe(201);
    expect(minted.status).toBe(403);
  });

  it('refuses a join secret that was already used', async () => {
    const { app, joinSecret } = setup();
    await joinSession(app, joinSecret);

    const again = await joinFrom(app, joinSecret);

    expect(again.status).toBe(401);
  });

  it('refuses a join from a non-loopback address', async () => {
    const { app, joinSecret } = setup();

    const response = await joinFrom(app, joinSecret, '10.0.0.5');

    expect(response.status).toBe(403);
  });

  it('refuses a wrong join secret', async () => {
    const { app } = setup();

    const response = await joinFrom(app, 'sf_join_not-the-secret');

    expect(response.status).toBe(401);
  });

  it('writes the join file readable only by its owner', () => {
    const { dataDir } = setup();

    const mode = statSync(join(dataDir, 'web-demo.join')).mode & 0o777;

    expect(mode).toBe(0o600);
  });
});
