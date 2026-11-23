import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { honoAdapter } from '../../src/adapters/hono/adapter';
import {
  publicProcedure,
  scopedProcedure,
} from '../../src/application/core/procedure';
import { errorResponse } from '@repo/zod-contract-kit/reply';
import {
  VALID_TOKEN,
  createTestApp,
  getJson,
  grantingAuth,
  postJson,
  type TestApp,
} from '../support/test-app';

const probeContract = {
  out: {
    200: z.object({ code: z.literal(200), ok: z.boolean() }),
    401: errorResponse(401, 'unauthorized'),
    403: errorResponse(403, 'forbidden'),
  },
};

const allOfProbe = scopedProcedure(['operator:read', 'operator:write'])(
  probeContract,
)(() => ({ code: 200 as const, ok: true }));

const publicProbe = publicProcedure(probeContract)(() => ({
  code: 200 as const,
  ok: true,
}));

const mountProbes = (app: TestApp): void => {
  app.get('/probe/all-of', honoAdapter(allOfProbe));
  app.get('/probe/public', honoAdapter(publicProbe));
};

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

const RESOLVE_PATH = '/api/v1/incidents/missing-incident/resolve';
const RESOLVE_BODY = { action: 'escalate' };

describe('procedure access rules', () => {
  it('a token with every required scope reaches a scoped route', async () => {
    const { app } = createTestApp({
      auth: grantingAuth(['operator:read']),
    });

    const response = await getJson(
      app,
      '/api/v1/projects',
      bearer(VALID_TOKEN),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      code: 200,
      projects: expect.any(Array),
    });
  });

  it('a token missing one of several required scopes is refused with the missing scope', async () => {
    const { app } = createTestApp({
      auth: grantingAuth(['operator:read']),
    });
    mountProbes(app);

    const response = await getJson(app, '/probe/all-of', bearer(VALID_TOKEN));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      code: 403,
      type: 'forbidden',
      message: 'Token lacks scope: operator:write',
    });
  });

  it('a token with one of several allowed scopes reaches an any-scoped route', async () => {
    const { app } = createTestApp({
      auth: grantingAuth(['operator:write']),
    });

    const response = await postJson(
      app,
      RESOLVE_PATH,
      RESOLVE_BODY,
      bearer(VALID_TOKEN),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      code: 404,
      type: 'not-found',
      message: 'Incident missing-incident not found',
    });
  });

  it('a token with none of the allowed scopes is refused with the allowed list', async () => {
    const { app } = createTestApp({
      auth: grantingAuth(['operator:read']),
    });

    const response = await postJson(
      app,
      RESOLVE_PATH,
      RESOLVE_BODY,
      bearer(VALID_TOKEN),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      code: 403,
      type: 'forbidden',
      message: 'Token needs one of: operator:write, factory:worker',
    });
  });

  it('a request with no bearer token is refused with 401 on a scoped route', async () => {
    const { app } = createTestApp();

    const response = await getJson(app, '/api/v1/projects');

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      code: 401,
      type: 'unauthorized',
      message: 'Missing or invalid bearer token',
    });
  });

  it('a public route answers with no bearer token', async () => {
    const { app } = createTestApp();
    mountProbes(app);

    const response = await getJson(app, '/probe/public');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ code: 200, ok: true });
  });
});
