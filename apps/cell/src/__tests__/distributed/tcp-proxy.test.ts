import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startHttpProxy, type HttpProxy } from './harness/tcp-proxy';

/** A trivial upstream that echoes the request body with its path, so a test can tell what arrived. */
let upstream: ReturnType<typeof Bun.serve>;
let proxy: HttpProxy;

beforeEach(() => {
  upstream = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: async (request) =>
      new Response(`${new URL(request.url).pathname}:${await request.text()}`),
  });
  proxy = startHttpProxy(`http://127.0.0.1:${upstream.port}`);
});

afterEach(() => {
  proxy.stop();
  upstream.stop(true);
});

const post = (path: string, body: string): Promise<Response> =>
  fetch(`${proxy.url}${path}`, { method: 'POST', body });

describe('the hostile proxy in front of a Cell', () => {
  it('carries requests and answers through unchanged', async () => {
    const answer = await post('/v1/cell/claim', 'hello');
    expect(answer.status).toBe(200);
    expect(await answer.text()).toBe('/v1/cell/claim:hello');
  });

  it('holds each request for the delay it is given', async () => {
    proxy.delay(150);
    const started = Date.now();
    await (await post('/v1/cell/heartbeat', 'x')).text();
    expect(Date.now() - started).toBeGreaterThanOrEqual(140);
    proxy.delay(0);
  });

  it('never delivers a dropped request to the upstream', async () => {
    proxy.dropRequests((request) => request.path === '/v1/cell/command', 1);
    await expect(post('/v1/cell/command', 'lost')).rejects.toThrow();
    expect(proxy.answered.map((request) => request.body)).not.toContain('lost');
    expect((await post('/v1/cell/command', 'next')).status).toBe(200);
  });

  it('lets the upstream act on a request whose answer is dropped', async () => {
    proxy.dropResponses((request) => request.path === '/v1/cell/command', 1);
    await expect(post('/v1/cell/command', 'done')).rejects.toThrow();
    expect(proxy.answered.map((request) => request.body)).toContain('done');
    expect(await (await post('/v1/cell/command', 'retry')).text()).toBe(
      '/v1/cell/command:retry',
    );
  });

  it('refuses every connection while cut, and answers again once healed', async () => {
    proxy.cut();
    await expect(post('/v1/cell/claim', 'x')).rejects.toThrow();
    proxy.heal();
    expect(await (await post('/v1/cell/claim', 'y')).text()).toBe(
      '/v1/cell/claim:y',
    );
  });

  it('keeps the same address across a cut', async () => {
    const before = proxy.url;
    proxy.cut();
    proxy.heal();
    expect(proxy.url).toBe(before);
  });
});
