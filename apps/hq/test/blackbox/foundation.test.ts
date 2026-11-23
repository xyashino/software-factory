import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { honoAdapter } from '../../src/adapters/hono/adapter';
import { StaleLeaseEpoch } from '../../src/application/core/error-handling';
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

const echoContract = {
  in: { body: z.object({ epoch: z.number().int() }) },
  out: {
    200: z.object({ code: z.literal(200), epoch: z.number() }),
    400: errorResponse(400, 'bad-request'),
  },
};

const readContract = {
  out: {
    200: z.object({ code: z.literal(200), ok: z.boolean() }),
    401: errorResponse(401, 'unauthorized'),
    403: errorResponse(403, 'forbidden'),
  },
};

const echoProcedure = publicProcedure(echoContract)((input) => ({
  code: 200 as const,
  epoch: input.body.epoch,
}));

const staleProcedure = publicProcedure(echoContract)(() => {
  throw new StaleLeaseEpoch('Job epoch moved on');
});

const undeclaredProcedure = publicProcedure(echoContract)(() => ({
  code: 201 as const,
}));

const malformedProcedure = publicProcedure(echoContract)(() => ({
  code: 200 as const,
  epoch: 'not-a-number',
}));

const readProcedure = scopedProcedure(['operator:read'])(readContract)(() => ({
  code: 200 as const,
  ok: true,
}));

const mountProbes = (app: TestApp): void => {
  app.post('/probe/echo', honoAdapter(echoProcedure));
  app.post('/probe/stale', honoAdapter(staleProcedure));
  app.post('/probe/undeclared', honoAdapter(undeclaredProcedure));
  app.post('/probe/malformed', honoAdapter(malformedProcedure));
  app.get('/probe/read', honoAdapter(readProcedure));
};

describe('HTTP foundation', () => {
  it('answers 400 when the body breaks the contract', async () => {
    const { app } = createTestApp();
    mountProbes(app);

    const response = await postJson(app, '/probe/echo', { epoch: 'soon' });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: 400,
      type: 'bad-request',
      message: expect.stringMatching(/^Invalid request payload: body\.epoch: /),
    });
  });

  it('answers 400 when the body is not JSON', async () => {
    const { app } = createTestApp();
    mountProbes(app);

    const response = await app.request('/probe/echo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ type: 'bad-request' });
  });

  it('answers 200 when the body matches the contract', async () => {
    const { app } = createTestApp();
    mountProbes(app);

    const response = await postJson(app, '/probe/echo', { epoch: 3 });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ code: 200, epoch: 3 });
  });

  it('answers 404 for a route that does not exist', async () => {
    const { app } = createTestApp();

    const response = await getJson(app, '/missing/route');

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      code: 404,
      type: 'not-found',
    });
  });

  it('answers 409 with the stale-lease-epoch type when the epoch has moved on', async () => {
    const { app } = createTestApp();
    mountProbes(app);

    const response = await postJson(app, '/probe/stale', { epoch: 1 });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: 409,
      type: 'stale-lease-epoch',
      message: 'Job epoch moved on',
    });
  });

  it('answers 500 when a handler replies with a code its contract does not declare', async () => {
    const { app } = createTestApp();
    mountProbes(app);

    const response = await postJson(app, '/probe/undeclared', { epoch: 1 });

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      code: 500,
      type: 'internal-server-error',
    });
  });

  it('answers 500 when a handler reply does not match its declared schema', async () => {
    const { app } = createTestApp();
    mountProbes(app);

    const response = await postJson(app, '/probe/malformed', { epoch: 1 });

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      code: 500,
      type: 'internal-server-error',
    });
  });

  it('answers 401 on a scoped route when no bearer token is sent', async () => {
    const { app } = createTestApp();
    mountProbes(app);

    const response = await getJson(app, '/probe/read');

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      code: 401,
      type: 'unauthorized',
    });
  });

  it('answers 403 on a scoped route when the token lacks the scope', async () => {
    const { app } = createTestApp({ auth: grantingAuth(['factory:worker']) });
    mountProbes(app);

    const response = await getJson(app, '/probe/read', {
      authorization: `Bearer ${VALID_TOKEN}`,
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      code: 403,
      type: 'forbidden',
    });
  });

  it('answers 200 on a scoped route when the token carries the scope', async () => {
    const { app } = createTestApp({ auth: grantingAuth(['operator:read']) });
    mountProbes(app);

    const response = await getJson(app, '/probe/read', {
      authorization: `Bearer ${VALID_TOKEN}`,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ code: 200, ok: true });
  });
});
