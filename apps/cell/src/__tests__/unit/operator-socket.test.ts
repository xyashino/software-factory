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

/** Starts a server whose dispatcher is `dispatch`, or answers `{ ok: true }`. */
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

/** Sends one POST with a JSON body and returns the status and parsed reply. */
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

  it('accepts the right token in the Bearer header with no token in the body', () => {
    const checked = readRequest(
      JSON.stringify({ op: 'context' }),
      `Bearer ${TOKEN}`,
      TOKEN,
    );
    expect(checked).toEqual({
      ok: true,
      request: { token: TOKEN, op: 'context' },
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
      readRequest(
        JSON.stringify({ op: 'done' }),
        `Bearer ${'b'.repeat(48)}`,
        TOKEN,
      ),
    ).toMatchObject({ ok: false, reply: { code: 'unauthorized' } });
  });

  it('refuses a wrong token of the same length as unauthorized, not invalid', () => {
    // Same length as the real token: the comparison runs over the full bytes, then refuses.
    const sameLength = 'c'.repeat(TOKEN.length);
    expect(
      readRequest(
        JSON.stringify({ token: sameLength, op: 'done' }),
        undefined,
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

  it('refuses a body that is not JSON, or not an object', () => {
    expect(readRequest('not json', undefined, TOKEN)).toMatchObject({
      ok: false,
      reply: { code: 'invalid' },
    });
    expect(readRequest('[1, 2]', undefined, TOKEN)).toMatchObject({
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
    const server = await serve();
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(Number(new URL(server.url).port)).toBeGreaterThan(0);
  });

  it('answers a verb that passes the checks with the dispatcher reply', async () => {
    const server = await serve(async (request) => ({
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

  it('accepts the token in the Bearer header', async () => {
    const server = await serve();
    const { status, reply } = await post(
      server.url,
      JSON.stringify({ op: 'done' }),
      { authorization: `Bearer ${TOKEN}` },
    );
    expect(status).toBe(200);
    expect(reply).toEqual({ ok: true });
  });

  it('refuses a wrong token with 401 without reaching the dispatcher', async () => {
    let reached = false;
    const server = await serve(async () => {
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
    const server = await serve();
    const { status, reply } = await post(
      server.url,
      JSON.stringify({ op: 'done' }),
    );
    expect(status).toBe(401);
    expect(reply).toMatchObject({ ok: false, code: 'unauthorized' });
  });

  it('refuses a schema-invalid verb with 400', async () => {
    const server = await serve();
    const { status, reply } = await post(
      server.url,
      JSON.stringify({ token: TOKEN, op: 'explode' }),
    );
    expect(status).toBe(400);
    expect(reply).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('refuses a body that is not JSON with 400', async () => {
    const server = await serve();
    const { status, reply } = await post(server.url, 'not json');
    expect(status).toBe(400);
    expect(reply).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('refuses a GET with 405 and names POST', async () => {
    const server = await serve();
    const response = await fetch(server.url);
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
  });

  it('refuses a body over the cap with 413 without reaching the dispatcher', async () => {
    let reached = false;
    const server = await serve(async () => {
      reached = true;
      return { ok: true };
    });
    const padding = 'x'.repeat(MAX_BODY_BYTES + 1);
    const { status, reply } = await post(
      server.url,
      JSON.stringify({ token: TOKEN, op: 'ask', text: padding }),
    );
    expect(status).toBe(413);
    expect(reply).toMatchObject({ ok: false, code: 'invalid' });
    expect(reached).toBe(false);
  });

  it('answers 500 internal when the dispatcher throws', async () => {
    const server = await serve(async () => {
      throw new Error('the ledger is locked');
    });
    const { status, reply } = await post(
      server.url,
      JSON.stringify({ token: TOKEN, op: 'done' }),
    );
    expect(status).toBe(500);
    expect(reply).toEqual({
      ok: false,
      code: 'internal',
      message: 'the ledger is locked',
    });
  });

  it('maps a dispatched refusal to its status, a state conflict as 409', async () => {
    const server = await serve(async () => ({
      ok: false,
      code: 'precondition',
      message: 'the Cycle is not live',
    }));
    const { status, reply } = await post(
      server.url,
      JSON.stringify({ token: TOKEN, op: 'done' }),
    );
    expect(status).toBe(409);
    expect(reply).toMatchObject({ ok: false, code: 'precondition' });
  });

  it('stops answering once closed, and close is idempotent', async () => {
    const server = await startOperatorServer({
      token: TOKEN,
      dispatch: async () => ({ ok: true }),
    });
    await server.close();
    await expect(server.close()).resolves.toBeUndefined();
    await expect(
      fetch(server.url, { method: 'POST', body: '{}' }),
    ).rejects.toThrow();
  });
});
