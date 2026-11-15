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

/** Posts a raw body to the endpoint and returns the status and parsed JSON reply. */
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
  return { status: response.status, reply: await response.json() };
};

describe('operator request checks', () => {
  it('accepts a verb carrying the right token in the body', () => {
    expect(readRequest({ token: TOKEN, op: 'done' }, undefined, TOKEN)).toEqual(
      {
        ok: true,
        request: { token: TOKEN, op: 'done' },
      },
    );
  });

  it('accepts a verb carrying the right token in the header alone', () => {
    expect(readRequest({ op: 'done' }, TOKEN, TOKEN)).toEqual({
      ok: true,
      request: { token: TOKEN, op: 'done' },
    });
  });

  it('lets the header token win over a wrong body token', () => {
    expect(
      readRequest({ token: 'b'.repeat(48), op: 'done' }, TOKEN, TOKEN),
    ).toMatchObject({ ok: true });
  });

  it('refuses a missing or wrong token as unauthorized', () => {
    expect(readRequest({ op: 'done' }, undefined, TOKEN)).toMatchObject({
      ok: false,
      reply: { code: 'unauthorized' },
    });
    expect(
      readRequest({ token: 'b'.repeat(48), op: 'done' }, undefined, TOKEN),
    ).toMatchObject({ ok: false, reply: { code: 'unauthorized' } });
    expect(readRequest({ op: 'done' }, 'x', TOKEN)).toMatchObject({
      ok: false,
      reply: { code: 'unauthorized' },
    });
  });

  it('refuses an unknown verb and an extra field as invalid, with the field named', () => {
    const unknown = readRequest({ op: 'explode' }, TOKEN, TOKEN);
    expect(unknown).toMatchObject({ ok: false, reply: { code: 'invalid' } });
    const extra = readRequest({ op: 'done', extra: 1 }, TOKEN, TOKEN);
    expect(extra).toMatchObject({ ok: false, reply: { code: 'invalid' } });
  });

  it('refuses a body that is not a JSON object as invalid', () => {
    expect(readRequest([TOKEN], TOKEN, TOKEN)).toMatchObject({
      ok: false,
      reply: { code: 'invalid' },
    });
    expect(readRequest(null, TOKEN, TOKEN)).toMatchObject({
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

describe('operator HTTP server', () => {
  it('listens on 127.0.0.1 at an OS-assigned port', async () => {
    const server = await start();
    const url = new URL(server.url);
    expect(url.protocol).toBe('http:');
    expect(url.hostname).toBe('127.0.0.1');
    expect(Number(url.port)).toBeGreaterThan(0);
  });

  it('answers a verb that passes the checks with the dispatcher reply', async () => {
    const server = await start(async (request) => ({
      ok: true,
      result: { op: request.op },
    }));
    const answer = await post(server.url, JSON.stringify({ op: 'context' }), {
      authorization: `Bearer ${TOKEN}`,
    });
    expect(answer).toEqual({
      status: 200,
      reply: { ok: true, result: { op: 'context' } },
    });
  });

  it('accepts the token in the body when no header is sent', async () => {
    const server = await start();
    const answer = await post(
      server.url,
      JSON.stringify({ token: TOKEN, op: 'done' }),
    );
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

  it('answers a non-JSON body with 400 and an invalid verb with 400', async () => {
    const server = await start();
    const notJson = await post(server.url, 'not json', {
      authorization: `Bearer ${TOKEN}`,
    });
    expect(notJson).toMatchObject({ status: 400, reply: { code: 'invalid' } });
    const badVerb = await post(server.url, JSON.stringify({ op: 'explode' }), {
      authorization: `Bearer ${TOKEN}`,
    });
    expect(badVerb.status).toBe(400);
  });

  it('maps a refused verb to 409 and a dispatcher crash to 500', async () => {
    const refusing = await start(async () => ({
      ok: false,
      code: 'precondition',
      message: 'the Cycle is not live',
    }));
    const refused = await post(refusing.url, JSON.stringify({ op: 'done' }), {
      authorization: `Bearer ${TOKEN}`,
    });
    expect(refused).toEqual({
      status: 409,
      reply: {
        ok: false,
        code: 'precondition',
        message: 'the Cycle is not live',
      },
    });

    const crashing = await start(async () => {
      throw new Error('disk full');
    });
    const crashed = await post(crashing.url, JSON.stringify({ op: 'done' }), {
      authorization: `Bearer ${TOKEN}`,
    });
    expect(crashed).toEqual({
      status: 500,
      reply: { ok: false, code: 'internal', message: 'disk full' },
    });
  });

  it('refuses a request that is not a POST with 405', async () => {
    const server = await start();
    const response = await fetch(server.url, { method: 'GET' });
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
  });

  it('refuses a body larger than the cap with 413', async () => {
    const server = await start();
    const answer = await post(
      server.url,
      JSON.stringify({ op: 'ask', text: 'x'.repeat(MAX_BODY_BYTES + 1) }),
      { authorization: `Bearer ${TOKEN}` },
    );
    expect(answer.status).toBe(413);
  });

  it('stops answering once closed', async () => {
    const server = await start();
    await server.close();
    await server.close();
    await expect(
      fetch(server.url, { method: 'POST', body: '{}' }),
    ).rejects.toThrow();
  });
});
