/**
 * A hostile proxy in front of one Cell's connection to the Factory. It listens on loopback and carries
 * each HTTP request to the upstream Factory, with the faults a test asks for:
 *
 * - `delay(ms)`: each request waits before it is forwarded;
 * - `dropRequests(match, n)`: the next `n` matching requests never reach the upstream;
 * - `dropResponses(match, n)`: the next `n` matching requests reach the upstream, which acts on them, but
 *   the answer never reaches the Cell (the connection is cut before the body);
 * - `cut()` / `heal()`: the listener and every open connection go away, then come back on the same port.
 *
 * Responses are streamed through, so keep-alive and the SSE feed work. Faults are counted, not random, so a
 * run is repeatable.
 */

/** One HTTP request as the proxy saw it. */
export interface ProxiedRequest {
  method: string;
  path: string;
  body: string;
}

export type RequestMatch = (request: ProxiedRequest) => boolean;

export interface HttpProxy {
  /** The address the Cell is given, e.g. `http://127.0.0.1:43123`. Stable across cut and heal. */
  readonly url: string;
  /** Every request that arrived while the proxy was listening, in order. */
  readonly seen: ProxiedRequest[];
  /** Every request the upstream answered (a dropped response still counts). */
  readonly answered: ProxiedRequest[];
  delay(ms: number): void;
  dropRequests(match: RequestMatch, times: number): void;
  dropResponses(match: RequestMatch, times: number): void;
  cut(): void;
  heal(): void;
  stop(): void;
}

interface Drop {
  kind: 'request' | 'response';
  match: RequestMatch;
  left: number;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** A response whose connection is cut before any byte of it is sent: the Cell sees a network error. */
const severed = (): Response =>
  new Response(
    new ReadableStream({
      start(controller) {
        controller.error(new Error('connection cut by the test proxy'));
      },
    }),
    { status: 200 },
  );

/** Headers a proxy must not copy: the connection's own, or ones the body no longer matches. */
const HOP_BY_HOP = [
  'host',
  'connection',
  'content-length',
  'content-encoding',
  'transfer-encoding',
  'keep-alive',
];

/** The request headers to carry upstream: everything but the hop-by-hop ones. */
const forwardedHeaders = (incoming: Headers): Headers => {
  const headers = new Headers(incoming);
  for (const name of HOP_BY_HOP) headers.delete(name);
  return headers;
};

/** The response headers to carry to the Cell. The body is the decoded stream, so no length or coding. */
const answeredHeaders = (upstream: Headers): Headers => {
  const headers = new Headers(upstream);
  for (const name of HOP_BY_HOP) headers.delete(name);
  return headers;
};

/** Starts a proxy that forwards to `upstream` (an `http://host:port` URL). */
export const startHttpProxy = (upstream: string): HttpProxy => {
  let server: ReturnType<typeof Bun.serve> | undefined;
  let port = 0;
  let delayMs = 0;
  let stopped = false;
  const drops: Drop[] = [];
  const seen: ProxiedRequest[] = [];
  const answered: ProxiedRequest[] = [];

  /** Uses one armed drop of this kind that matches the request, if there is one. */
  const takeDrop = (kind: Drop['kind'], request: ProxiedRequest): boolean => {
    const drop = drops.find(
      (candidate) =>
        candidate.kind === kind &&
        candidate.left > 0 &&
        candidate.match(request),
    );
    if (drop === undefined) return false;
    drop.left -= 1;
    return true;
  };

  const carry = async (incoming: Request): Promise<Response> => {
    const url = new URL(incoming.url);
    const request: ProxiedRequest = {
      method: incoming.method,
      path: url.pathname,
      body: await incoming.text(),
    };
    seen.push(request);
    if (delayMs > 0) await sleep(delayMs);
    if (takeDrop('request', request)) return severed();

    const init: RequestInit = {
      method: incoming.method,
      headers: forwardedHeaders(incoming.headers),
    };
    if (request.body !== '') init.body = request.body;
    const upstreamAnswer = await fetch(
      `${upstream}${url.pathname}${url.search}`,
      init,
    );
    answered.push(request);
    if (takeDrop('response', request)) return severed();
    return new Response(upstreamAnswer.body, {
      status: upstreamAnswer.status,
      statusText: upstreamAnswer.statusText,
      headers: answeredHeaders(upstreamAnswer.headers),
    });
  };

  const listen = (): void => {
    server = Bun.serve({
      hostname: '127.0.0.1',
      port,
      fetch: (incoming) =>
        carry(incoming).catch(
          (error: unknown) =>
            new Response(
              error instanceof Error ? error.message : 'proxy error',
              { status: 502 },
            ),
        ),
    });
    port = server.port ?? port;
  };

  listen();

  return {
    get url() {
      return `http://127.0.0.1:${port}`;
    },
    seen,
    answered,
    delay: (ms) => {
      delayMs = ms;
    },
    dropRequests: (match, times) => {
      drops.push({ kind: 'request', match, left: times });
    },
    dropResponses: (match, times) => {
      drops.push({ kind: 'response', match, left: times });
    },
    cut: () => {
      if (server === undefined || stopped) return;
      server.stop(true);
      server = undefined;
    },
    heal: () => {
      if (server !== undefined || stopped) return;
      listen();
    },
    stop: () => {
      if (stopped) return;
      stopped = true;
      server?.stop(true);
      server = undefined;
    },
  };
};
