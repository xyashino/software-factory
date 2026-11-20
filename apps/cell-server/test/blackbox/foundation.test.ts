import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { honoAdapter } from '../../src/adapters/hono/adapter';
import { publicProcedure } from '../../src/application/core/procedure';
import { errorResponse } from '../../src/contracts/common';
import { MAX_BODY_BYTES } from '../../src/config';
import {
  createTestApp,
  getJson,
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

const echoProcedure = publicProcedure(echoContract)((input) => ({
  code: 200 as const,
  epoch: input.body.epoch,
}));

const mountProbe = (app: TestApp): void => {
  app.post('/probe/echo', honoAdapter(echoProcedure));
};

describe('health endpoint', () => {
  it('reports the process id, no default factory and zero cells on a fresh database', async () => {
    const { app } = createTestApp();

    const response = await getJson(app, '/api/v1/health');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      code: 200,
      pid: process.pid,
      defaultFactory: null,
      cells: {
        total: 0,
        byRuntimeStatus: {
          starting: 0,
          running: 0,
          stopping: 0,
          stopped: 0,
          failed: 0,
        },
      },
    });
  });
});

describe('HTTP error shapes', () => {
  it('answers 404 for a route that does not exist', async () => {
    const { app } = createTestApp();

    const response = await getJson(app, '/missing/route');

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      code: 404,
      type: 'not-found',
      message: 'Route not found: GET /missing/route',
    });
  });

  it('answers 400 when the body breaks the contract', async () => {
    const { app } = createTestApp();
    mountProbe(app);

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
    mountProbe(app);

    const response = await app.request('/probe/echo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ type: 'bad-request' });
  });

  it('answers 413 when the body is larger than the limit', async () => {
    const { app } = createTestApp();
    mountProbe(app);
    const response = await postJson(app, '/probe/echo', {
      epoch: 1,
      padding: 'x'.repeat(MAX_BODY_BYTES),
    });

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({
      code: 413,
      type: 'payload-too-large',
    });
  });

  it('answers 200 when the body matches the contract', async () => {
    const { app } = createTestApp();
    mountProbe(app);

    const response = await postJson(app, '/probe/echo', { epoch: 3 });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ code: 200, epoch: 3 });
  });
});
