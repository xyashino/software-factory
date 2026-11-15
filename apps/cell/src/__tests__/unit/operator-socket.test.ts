import { afterEach, describe, expect, it } from 'vitest';
import {
  MAX_BODY_BYTES,
  newCycleToken,
  readRequest,
  startOperatorServer,
  type OperatorServer,
} from '../../operator-socket';

const TOKEN = 'a'.repeat(48);
const servers: OperatorServer[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
});

/** Starts an endpoint for one Cycle and keeps it for cleanup. */
const serve = async (
  dispatch: Parameters<
    typeof startOperatorServer
  >[0]['dispatch'] = async () => ({
    ok: true,
  }),
): Promise<OperatorServer> => {
  const server = await startOperatorServer({ token: TOKEN, dispatch });
  servers.push(server);
  return server;
};

/** POSTs a raw body to the endpoint, with an optional Bearer token. */
const post = (url: string, body: string, bearer?: string): Promise<Response> =>
  fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(bearer === undefined ? {} : { authorization: `Bearer ${bearer}` }),
    },
    body,
  });

describe('operator request checks', () => {
  it('accepts a verb carrying the right token in the body', () => {
    const checked = readRequest(
      JSON.stringify({ token: TOKEN, op: 'done' }),
      undefined,
      TOKEN,
    );
    expect(checked).toEqual({
      ok: true,
      request: { token: TOKEN, op: 'done' },
    });
  });

  it('accepts a verb carrying the right token in the Authorization header alone', () => {
    const checked = readRequest(JSON.stringify({ op: 'done' }), TOKEN, TOKEN);
    expect(checked).toEqual({
      ok: true,
      request: { token: TOKEN, op: 'done' },
    });
  });

  it('refuses a missing or wrong token as unauthorized', () => {
    expect(
      readRequest(JSON.stringify({ op: 'done' }), undefined, TOKEN),
    ).toMatchObject({ ok: false, reply: { code: 'unauthorized' } });
    expect(
      readRequest(
        JSON.stringify({ token: 'b'.repeat(48), op: 'done' }),
        undefined,
        TOKEN,
      ),
    ).toMatchObject({ ok: false, reply: { code: 'unauthorized' } });
    expect(
      readRequest(JSON.stringify({ op: 'done' }), 'c'.repeat(48), TOKEN),
    ).toMatchObject({ ok: false, reply: { code: 'unauthorized' } });
  });

  it('refuses an unknown verb and an extra field as invalid, with the field named', () => {
    const unknown = readRequest(
      JSON.stringify({ token: TOKEN, op: 'explode' }),
      undefined,
      TOKEN,
    );
    expect(unknown).toMatchObject({ ok: false, reply: { code: 'invalid' } });
    const extra = readRequest(
      JSON.stringify({ token: TOKEN, op: 'done', extra: 1 }),
      undefined,
      TOKEN,
    );
    expect(extra).toMatchObject({ ok: false, reply: { code: 'invalid' } });
  });

  it('refuses a body that is not JSON', () => {
    expect(readRequest('not json', undefined, TOKEN)).toMatchObject({
      ok: false,
      reply: { code: 'invalid' },
    });
  });

  it('issues a fresh 48-character hex token per Cycle', () => {
    const first = newCycleToken();
    expect(first).toMatch(/^[0-9a-f]{48}$/);
    expect(newCycleToken()).not.toBe(first);
  });
});

describe('operator endpoint server', () => {
  it('binds 127.0.0.1 on an ephemeral port and reports its URL', async () => {
    const server = await serve();
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const port = Number(new URL(server.url).port);
    expect(port).toBeGreaterThan(0);
  });

  it('answers a verb that passes the checks with the dispatcher reply', async () => {
    const server = await serve(async (request) => ({
      ok: true,
      result: { op: request.op },
    }));
    const response = await post(
      server.url,
      JSON.stringify({ token: TOKEN, op: 'context' }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual({
      ok: true,
      result: { op: 'context' },
    });
  });

  it('accepts the token from the Authorization header alone', async () => {
    const server = await serve();
    const response = await post(
      server.url,
      JSON.stringify({ op: 'done' }),
      TOKEN,
    );
    expect(response.status).toBe(200);
  });

  it('refuses a wrong token with 401 without reaching the dispatcher', async () => {
    let reached = false;
    const server = await serve(async () => {
      reached = true;
      return { ok: true };
    });
    const response = await post(
      server.url,
      JSON.stringify({ token: 'x', op: 'done' }),
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      ok: false,
      code: 'unauthorized',
    });
    const headerOnly = await post(
      server.url,
      JSON.stringify({ op: 'done' }),
      'y'.repeat(48),
    );
    expect(headerOnly.status).toBe(401);
    expect(reached).toBe(false);
  });

  it('refuses an invalid verb with 400 and names the field', async () => {
    const server = await serve();
    const response = await post(
      server.url,
      JSON.stringify({ token: TOKEN, op: 'explode' }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'invalid' });
  });

  it('refuses a body that is not JSON with 400', async () => {
    const server = await serve();
    const response = await post(server.url, 'not json', TOKEN);
    expect(response.status).toBe(400);
  });

  it('answers any method but POST with 405', async () => {
    const server = await serve();
    const response = await fetch(server.url, { method: 'GET' });
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
  });

  it('refuses a body larger than the cap with 413', async () => {
    const server = await serve();
    const padding = 'x'.repeat(MAX_BODY_BYTES);
    const response = await post(
      server.url,
      JSON.stringify({ token: TOKEN, op: 'ask', text: padding }),
    );
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ code: 'invalid' });
  });

  it('maps a refused verb to 409 and keeps its code', async () => {
    const server = await serve(async () => ({
      ok: false,
      code: 'precondition',
      message: 'the Cycle is not live',
    }));
    const response = await post(
      server.url,
      JSON.stringify({ token: TOKEN, op: 'done' }),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      ok: false,
      code: 'precondition',
      message: 'the Cycle is not live',
    });
  });

  it('answers 500 internal when the dispatcher throws', async () => {
    const server = await serve(async () => {
      throw new Error('the store is down');
    });
    const response = await post(
      server.url,
      JSON.stringify({ token: TOKEN, op: 'done' }),
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      ok: false,
      code: 'internal',
      message: 'the store is down',
    });
  });

  it('stops answering once closed, and closing twice is safe', async () => {
    const server = await startOperatorServer({
      token: TOKEN,
      dispatch: async () => ({ ok: true }),
    });
    await server.close();
    await server.close();
    await expect(post(server.url, '{}', TOKEN)).rejects.toThrow();
  });
});
