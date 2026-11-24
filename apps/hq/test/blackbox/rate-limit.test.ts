import { describe, expect, it } from 'vitest';
import { mintAdminToken } from '../../src/bootstrap/admin';
import { createTestApp, getJson, type TestApp } from '../support/test-app';

const WINDOW_MS = 60_000;
const LIMIT = 3;
const LOOPBACK = '127.0.0.1';
const OTHER_PEER = '10.0.0.5';

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

const setup = async () => {
  const context = createTestApp({
    safeTokenAuth: true,
    rateLimit: {
      tokenQuota: { limit: LIMIT, windowMs: WINDOW_MS },
      authFailureBrake: { limit: LIMIT, windowMs: WINDOW_MS },
    },
  });
  const admin = await mintAdminToken(context.storage, context.clock);
  return { ...context, admin };
};

const getFrom = (
  app: TestApp,
  path: string,
  token: string,
  remoteAddress: string = LOOPBACK,
): Promise<Response> =>
  Promise.resolve(
    app.request(path, { headers: bearer(token) }, { remoteAddress }),
  );

describe('auth failure brake', () => {
  it('answers 429 with Retry-After once one IP exceeds its auth failures', async () => {
    const { app } = await setup();
    for (let attempt = 0; attempt < LIMIT; attempt += 1)
      await getFrom(app, '/api/v1/projects', 'sf_sup_guess');

    const braked = await getFrom(app, '/api/v1/projects', 'sf_sup_guess');

    expect(braked.status).toBe(429);
    expect(braked.headers.get('retry-after')).toBe('60');
  });

  it('blocks even a valid token from a braked IP', async () => {
    const { app, admin } = await setup();
    for (let attempt = 0; attempt < LIMIT; attempt += 1)
      await getFrom(app, '/api/v1/projects', 'sf_sup_guess');

    const response = await getFrom(app, '/api/v1/projects', admin);

    expect(response.status).toBe(429);
  });

  it('keeps one IP braking from affecting another IP', async () => {
    const { app, admin } = await setup();
    for (let attempt = 0; attempt < LIMIT; attempt += 1)
      await getFrom(app, '/api/v1/projects', 'sf_sup_guess', OTHER_PEER);

    const response = await getFrom(app, '/api/v1/projects', admin);

    expect(response.status).toBe(200);
  });

  it('lets the IP through again once the window passes', async () => {
    const { app, clock } = await setup();
    for (let attempt = 0; attempt < LIMIT; attempt += 1)
      await getFrom(app, '/api/v1/projects', 'sf_sup_guess');
    clock.advance(WINDOW_MS);

    const response = await getFrom(app, '/api/v1/projects', 'sf_sup_guess');

    expect(response.status).toBe(401);
  });
});

describe('per-token quota', () => {
  it('answers 429 with Retry-After when one token bursts past its quota', async () => {
    const { app, admin } = await setup();
    for (let attempt = 0; attempt < LIMIT; attempt += 1)
      await getJson(app, '/api/v1/projects', bearer(admin));

    const response = await getJson(app, '/api/v1/projects', bearer(admin));

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
  });

  it('keeps serving another token while one token is over quota', async () => {
    const { app, admin, storage, clock } = await setup();
    const other = await mintAdminToken(storage, clock);
    for (let attempt = 0; attempt < LIMIT; attempt += 1)
      await getJson(app, '/api/v1/projects', bearer(admin));

    const response = await getJson(app, '/api/v1/projects', bearer(other));

    expect(response.status).toBe(200);
  });

  it('restores the quota once the window passes', async () => {
    const { app, admin, clock } = await setup();
    for (let attempt = 0; attempt <= LIMIT; attempt += 1)
      await getJson(app, '/api/v1/projects', bearer(admin));
    clock.advance(WINDOW_MS);

    const response = await getJson(app, '/api/v1/projects', bearer(admin));

    expect(response.status).toBe(200);
  });

  it('does not count requests outside the API prefix', async () => {
    const { app, admin } = await setup();
    for (let attempt = 0; attempt < LIMIT + 2; attempt += 1)
      await app.request('/unknown', { headers: bearer(admin) });

    const response = await getJson(app, '/api/v1/projects', bearer(admin));

    expect(response.status).toBe(200);
  });
});
