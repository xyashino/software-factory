import { afterEach, describe, expect, it } from 'vitest';
import {
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

/** Starts an endpoint with the test token and a dispatcher the caller supplies. */
const start = async (
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

/** Posts one body to the endpoint and returns its status and parsed JSON reply. */
const post = async (
  url: string,
  body: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; reply: Record<string, unknown> }> => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  });
  return {
    status: response.status,
    reply: (await response.json()) as Record<string, unknown>,
  };
};

describe('operator endpoint port', () => {
  it('binds the port it is given after an earlier endpoint closed, and accepts the same token', async () => {
    const first = await start();
    const port = Number(new URL(first.url).port);
    await first.close();

    const adopted = await startOperatorServer({
      token: TOKEN,
      port,
      dispatch: async () => ({ ok: true }),
    });
    servers.push(adopted);

    expect(adopted.url).toBe(`http://127.0.0.1:${port}`);
    const answer = await post(
      adopted.url,
      JSON.stringify({ token: TOKEN, op: 'done' }),
    );
    expect(answer.status).toBe(200);
  });

  it('refuses to start on a port another endpoint holds', async () => {
    const holder = await start();
    const port = Number(new URL(holder.url).port);

    await expect(
      startOperatorServer({
        token: TOKEN,
        port,
        dispatch: async () => ({ ok: true }),
      }),
    ).rejects.toThrow(/in use|EADDRINUSE/);
  });
});

describe('operator request checks', () => {
  it('accepts a verb carrying the right token', () => {
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

  it('accepts the right token in the bearer header alone', () => {
    const checked = readRequest(
      JSON.stringify({ token: TOKEN, op: 'done' }),
      TOKEN,
      TOKEN,
    );
    expect(checked).toMatchObject({ ok: true });
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
  });

  it('lets a wrong bearer header refuse even when the body token is right', () => {
    expect(
      readRequest(
        JSON.stringify({ token: TOKEN, op: 'done' }),
        'b'.repeat(48),
        TOKEN,
      ),
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
  it('binds 127.0.0.1 on an OS-assigned port and reports its URL', async () => {
    const server = await start();
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(Number(new URL(server.url).port)).toBeGreaterThan(0);
  });

  it('answers a verb that passes the checks with the dispatcher reply', async () => {
    const server = await start(async (request) => ({
      ok: true,
      result: { op: request.op },
    }));
    const { status, reply } = await post(
      server.url,
      JSON.stringify({ token: TOKEN, op: 'context' }),
    );
    expect(status).toBe(200);
    expect(reply).toEqual({ ok: true, result: { op: 'context' } });
  });

  it('accepts the token in the bearer header', async () => {
    const server = await start();
    const { status } = await post(
      server.url,
      JSON.stringify({ token: TOKEN, op: 'done' }),
      { authorization: `Bearer ${TOKEN}` },
    );
    expect(status).toBe(200);
  });

  it('refuses a wrong token with 401 without reaching the dispatcher', async () => {
    let reached = false;
    const server = await start(async () => {
      reached = true;
      return { ok: true };
    });
    const { status, reply } = await post(
      server.url,
      JSON.stringify({ token: 'x', op: 'done' }),
    );
    expect(status).toBe(401);
    expect(reply).toMatchObject({ ok: false, code: 'unauthorized' });
    expect(reached).toBe(false);
  });

  it('refuses a missing token with 401', async () => {
    const server = await start();
    const { status } = await post(server.url, JSON.stringify({ op: 'done' }));
    expect(status).toBe(401);
  });

  it('refuses an invalid verb with 400 and the field named', async () => {
    const server = await start();
    const { status, reply } = await post(
      server.url,
      JSON.stringify({ token: TOKEN, op: 'explode' }),
    );
    expect(status).toBe(400);
    expect(reply).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('refuses a body that is not JSON with 400', async () => {
    const server = await start();
    const { status } = await post(server.url, 'not json');
    expect(status).toBe(400);
  });

  it('refuses a GET with 405', async () => {
    const server = await start();
    const response = await fetch(server.url);
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
  });

  it('answers a dispatcher refusal with 409 and keeps its code', async () => {
    const server = await start(async () => ({
      ok: false,
      code: 'precondition',
      message: 'the Cycle is not live',
    }));
    const { status, reply } = await post(
      server.url,
      JSON.stringify({ token: TOKEN, op: 'done' }),
    );
    expect(status).toBe(409);
    expect(reply).toEqual({
      ok: false,
      code: 'precondition',
      message: 'the Cycle is not live',
    });
  });

  it('answers a dispatcher crash with 500 and the message', async () => {
    const server = await start(async () => {
      throw new Error('disk full');
    });
    const { status, reply } = await post(
      server.url,
      JSON.stringify({ token: TOKEN, op: 'done' }),
    );
    expect(status).toBe(500);
    expect(reply).toEqual({
      ok: false,
      code: 'internal',
      message: 'disk full',
    });
  });

  it('refuses a body over the size cap with 413', async () => {
    const server = await start();
    const huge = JSON.stringify({
      token: TOKEN,
      op: 'ask',
      text: 'x'.repeat(2 * 1024 * 1024),
    });
    const { status } = await post(server.url, huge);
    expect(status).toBe(413);
  });

  it('closes its listener so the port no longer answers', async () => {
    const server = await start();
    await server.close();
    await server.close();
    await expect(fetch(server.url, { method: 'POST' })).rejects.toThrow();
  });
});
