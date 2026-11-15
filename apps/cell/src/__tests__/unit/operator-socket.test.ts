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

/** Posts one body to the Operator endpoint and returns the status and the parsed reply. */
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

describe('operator request checks', () => {
  it('accepts a verb carrying the right token in its body', () => {
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

  it('accepts the right token in the Bearer header, with no token in the body', () => {
    const checked = readRequest(JSON.stringify({ op: 'done' }), TOKEN, TOKEN);
    expect(checked).toEqual({
      ok: true,
      request: { token: TOKEN, op: 'done' },
    });
  });

  it('refuses a missing or wrong token as unauthorized, with 401', () => {
    expect(
      readRequest(JSON.stringify({ op: 'done' }), undefined, TOKEN),
    ).toMatchObject({
      ok: false,
      status: 401,
      reply: { code: 'unauthorized' },
    });
    expect(
      readRequest(
        JSON.stringify({ token: 'b'.repeat(48), op: 'done' }),
        undefined,
        TOKEN,
      ),
    ).toMatchObject({
      ok: false,
      status: 401,
      reply: { code: 'unauthorized' },
    });
  });

  it('lets the header decide: a wrong header is refused even when the body token is right', () => {
    expect(
      readRequest(
        JSON.stringify({ token: TOKEN, op: 'done' }),
        'b'.repeat(48),
        TOKEN,
      ),
    ).toMatchObject({
      ok: false,
      status: 401,
      reply: { code: 'unauthorized' },
    });
  });

  it('refuses an unknown verb and an extra field as invalid, with 400', () => {
    const unknown = readRequest(
      JSON.stringify({ token: TOKEN, op: 'explode' }),
      undefined,
      TOKEN,
    );
    expect(unknown).toMatchObject({
      ok: false,
      status: 400,
      reply: { code: 'invalid' },
    });
    const extra = readRequest(
      JSON.stringify({ token: TOKEN, op: 'done', extra: 1 }),
      undefined,
      TOKEN,
    );
    expect(extra).toMatchObject({
      ok: false,
      status: 400,
      reply: { code: 'invalid' },
    });
  });

  it('refuses a body that is not JSON, with 400', () => {
    expect(readRequest('not json', undefined, TOKEN)).toMatchObject({
      ok: false,
      status: 400,
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
  it('listens on 127.0.0.1 at an OS-assigned port, as an http URL', async () => {
    const server = await start();
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(Number(new URL(server.url).port)).toBeGreaterThan(0);
  });

  it('answers a verb that passes the checks with the dispatcher reply', async () => {
    const server = await start(async (request) => ({
      ok: true,
      result: { op: request.op },
    }));
    const answer = await post(
      server.url,
      JSON.stringify({ token: TOKEN, op: 'context' }),
    );
    expect(answer).toEqual({
      status: 200,
      reply: { ok: true, result: { op: 'context' } },
    });
  });

  it('accepts the token in the Bearer header', async () => {
    const server = await start();
    const answer = await post(server.url, JSON.stringify({ op: 'done' }), {
      authorization: `Bearer ${TOKEN}`,
    });
    expect(answer).toEqual({ status: 200, reply: { ok: true } });
  });

  it('refuses a wrong token with 401 without reaching the dispatcher', async () => {
    let reached = false;
    const server = await start(async () => {
      reached = true;
      return { ok: true };
    });
    const answer = await post(
      server.url,
      JSON.stringify({ token: 'x', op: 'done' }),
    );
    expect(answer.status).toBe(401);
    expect(answer.reply).toMatchObject({ ok: false, code: 'unauthorized' });
    expect(reached).toBe(false);
  });

  it('refuses a request that is not POST with 405', async () => {
    const server = await start();
    const response = await fetch(server.url, { method: 'GET' });
    expect(response.status).toBe(405);
  });

  it('refuses a body that fails the verb schema with 400', async () => {
    const server = await start();
    const answer = await post(
      server.url,
      JSON.stringify({ token: TOKEN, op: 'explode' }),
    );
    expect(answer.status).toBe(400);
    expect(answer.reply).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('refuses a body over the size cap with 413', async () => {
    const server = await start();
    const answer = await post(server.url, 'x'.repeat(MAX_BODY_BYTES + 1));
    expect(answer.status).toBe(413);
    expect(answer.reply).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('answers 500 internal when the dispatcher throws', async () => {
    const server = await start(async () => {
      throw new Error('boom');
    });
    const answer = await post(
      server.url,
      JSON.stringify({ token: TOKEN, op: 'done' }),
    );
    expect(answer).toEqual({
      status: 500,
      reply: { ok: false, code: 'internal', message: 'boom' },
    });
  });

  it('closes idempotently, and the URL refuses connections afterwards', async () => {
    const server = await start();
    await server.close();
    await expect(server.close()).resolves.toBeUndefined();
    await expect(
      post(server.url, JSON.stringify({ token: TOKEN, op: 'done' })),
    ).rejects.toThrow();
  });
});
