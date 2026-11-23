import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { honoAdapter } from '../../src/adapters/hono/adapter';
import { publicProcedure } from '../../src/application/core/procedure';
import { errorResponse } from '@repo/zod-contract-kit/reply';
import { createTestApp, postJson } from '../support/test-app';

const echoContract = {
  in: { body: z.object({ epoch: z.number().int() }) },
  out: {
    200: z.object({ code: z.literal(200), epoch: z.number() }),
    400: errorResponse(400, 'bad-request'),
  },
};

const undeclaredBodyContract = {
  out: {
    200: z.object({ code: z.literal(200) }),
  },
};

const echoProcedure = publicProcedure(echoContract)((input) => ({
  code: 200 as const,
  epoch: input.body.epoch,
}));

const undeclaredBodyProcedure = publicProcedure(undeclaredBodyContract)(() => ({
  code: 200 as const,
}));

const mountProbes = (app: ReturnType<typeof createTestApp>['app']): void => {
  app.post('/probe/echo', honoAdapter(echoProcedure));
  app.post('/probe/undeclared', honoAdapter(undeclaredBodyProcedure));
};

describe('declared request sections', () => {
  it('ignores a body the contract does not declare', async () => {
    const { app } = createTestApp();
    mountProbes(app);

    const response = await app.request('/probe/undeclared', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'not json at all',
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ code: 200 });
  });

  it('rejects a declared body sent without a JSON content type', async () => {
    const { app } = createTestApp();
    mountProbes(app);

    const response = await app.request('/probe/echo', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: '{"epoch":3}',
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: 400,
      type: 'bad-request',
      message: 'Unsupported Content-Type, expected application/json',
    });
  });

  it('accepts a declared body sent as JSON', async () => {
    const { app } = createTestApp();
    mountProbes(app);

    const response = await postJson(app, '/probe/echo', { epoch: 3 });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ code: 200, epoch: 3 });
  });

  it('keeps the malformed JSON message when the body is not valid JSON', async () => {
    const { app } = createTestApp();
    mountProbes(app);

    const response = await app.request('/probe/echo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: 400,
      type: 'bad-request',
      message: 'Malformed JSON body',
    });
  });

  it('lets the contract reject an empty declared body', async () => {
    const { app } = createTestApp();
    mountProbes(app);

    const response = await app.request('/probe/echo', { method: 'POST' });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: 400,
      type: 'bad-request',
      message: expect.stringMatching(/^Invalid request payload: body: /),
    });
  });
});
