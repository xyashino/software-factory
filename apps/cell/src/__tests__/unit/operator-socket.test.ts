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

/** Posts one body to the endpoint and returns the status and the parsed reply. */
const post = async (
  url: string,
  body: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; reply: unknown }> => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  });
  return {
    status: response.status,
    reply: await response.json(),
  };
};

describe('operator request checks', () => {
  it('accepts a verb carrying the right token in the body', () => {
    const checked = readRequest(
      JSON.stringify({ token: TOKEN, op: 'done' }),
      TOKEN,
    );
    expect(checked).toEqual({
      ok: true,
      request: { token: TOKEN, op: 'done' },
    });
  });

  it('accepts the right token as a Bearer header when the body has none', () => {
    const checked = readRequest(
      JSON.stringify({ op: 'done' }),
      TOKEN,
      `Bearer ${TOKEN}`,
    );
    expect(checked).toEqual({
      ok: true,
      request: { token: TOKEN, op: 'done' },
    });
  });

  it('refuses a missing or wrong token as unauthorized, with status 401', () => {
    expect(readRequest(JSON.stringify({ op: 'done' }), TOKEN)).toMatchObject({
      ok: false,
      status: 401,
      reply: { code: 'unauthorized' },
    });
    expect(
      readRequest(JSON.stringify({ token: 'b'.repeat(48), op: 'done' }), TOKEN),
    ).toMatchObject({
      ok: false,
      status: 401,
      reply: { code: 'unauthorized' },
    });
  });

  it('refuses a wrong-length token the same way as a same-length one', () => {
    expect(
      readRequest(JSON.stringify({ token: 'x', op: 'done' }), TOKEN),
    ).toMatchObject({
      ok: false,
      status: 401,
      reply: { code: 'unauthorized' },
    });
  });

  it('refuses a wrong Bearer header even when the body carries the right token', () => {
    expect(
      readRequest(
        JSON.stringify({ token: TOKEN, op: 'done' }),
        TOKEN,
        'Bearer wrong',
      ),
    ).toMatchObject({
      ok: false,
      status: 401,
      reply: { code: 'unauthorized' },
    });
  });

  it('refuses an unknown verb and an extra field as invalid, with status 400', () => {
    const unknown = readRequest(
      JSON.stringify({ token: TOKEN, op: 'explode' }),
      TOKEN,
    );
    expect(unknown).toMatchObject({
      ok: false,
      status: 400,
      reply: { code: 'invalid' },
    });
    const extra = readRequest(
      JSON.stringify({ token: TOKEN, op: 'done', extra: 1 }),
      TOKEN,
    );
    expect(extra).toMatchObject({
      ok: false,
      status: 400,
      reply: { code: 'invalid' },
    });
  });

  it('refuses a body that is not JSON as invalid', () => {
    expect(readRequest('not json', TOKEN)).toMatchObject({
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
  it('listens on 127.0.0.1 at an OS-assigned port, with no file on disk', async () => {
    const server = await start();
    const url = new URL(server.url);
    expect(url.protocol).toBe('http:');
    expect(url.hostname).toBe('127.0.0.1');
    expect(Number(url.port)).toBeGreaterThan(0);
  });

  it('answers a verb that passes the checks with the dispatcher reply, status 200', async () => {
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

  it('accepts the token as a Bearer header', async () => {
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
    expect(answer).toMatchObject({
      status: 401,
      reply: { ok: false, code: 'unauthorized' },
    });
    expect(reached).toBe(false);
  });

  it('refuses a body that fails the verb schema with 400', async () => {
    const server = await start();
    const answer = await post(
      server.url,
      JSON.stringify({ token: TOKEN, op: 'explode' }),
    );
    expect(answer).toMatchObject({ status: 400, reply: { code: 'invalid' } });
  });

  it('refuses a GET with 405', async () => {
    const server = await start();
    const response = await fetch(server.url);
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
  });

  it('refuses a body over the size limit with 413', async () => {
    const server = await start();
    const answer = await post(
      server.url,
      JSON.stringify({
        token: TOKEN,
        op: 'ask',
        text: 'x'.repeat(MAX_BODY_BYTES),
      }),
    );
    expect(answer).toMatchObject({ status: 413, reply: { code: 'invalid' } });
  });

  it('answers 500 internal when the dispatcher throws', async () => {
    const server = await start(async () => {
      throw new Error('the runtime is gone');
    });
    const answer = await post(
      server.url,
      JSON.stringify({ token: TOKEN, op: 'done' }),
    );
    expect(answer).toEqual({
      status: 500,
      reply: { ok: false, code: 'internal', message: 'the runtime is gone' },
    });
  });

  it('closes its listener and is idempotent on a second close', async () => {
    const server = await start();
    await server.close();
    await expect(server.close()).resolves.toBeUndefined();
    await expect(
      fetch(server.url, { method: 'POST', body: '{}' }),
    ).rejects.toThrow();
  });
});
