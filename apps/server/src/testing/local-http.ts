/**
 * Test helpers for the HTTP transport: a listener on a free loopback port, and the client a local CLI
 * uses to call it (the codec of PROTOCOL §3.0, the same bytes the CLI sends). Tests that once spoke over
 * a Unix socket speak to this listener instead.
 */
import type { FactoryClient } from '@repo/factory-core/contracts/client';
import {
  decodeHttpAnswer,
  encodeHttpCall,
} from '@repo/factory-core/contracts/http-codec';
import {
  ROUTES,
  type RouteName,
  type RouteRequest,
  type RouteResponse,
} from '@repo/factory-core/contracts/routes';
import type { StoredEvent } from '@repo/factory-core/order/events';
import type { Runtime } from '@repo/factory-runtime/composition';
import { startHttpListener, type HttpListener } from '../http/listener';

/** The local supervisor token every test listener accepts. */
export const LOCAL_TEST_TOKEN = 'local-test-token';

/** Serves the runtime on a free loopback port, with the local supervisor token. */
export const listenLocal = (runtime: Runtime): HttpListener =>
  startHttpListener({
    runtime,
    hostname: '127.0.0.1',
    port: 0,
    localToken: LOCAL_TEST_TOKEN,
  });

/** The FactoryClient of one server: every route, over HTTP with the bearer token. */
export const httpClient = (
  baseUrl: string,
  token: string = LOCAL_TEST_TOKEN,
): FactoryClient => ({
  call: async <K extends RouteName>(
    route: K,
    request: RouteRequest<K>,
  ): Promise<RouteResponse<K>> => {
    const parsed = ROUTES[route].request.parse(request) as RouteRequest<K>;
    const encoded = encodeHttpCall(route, parsed);
    const headers: Record<string, string> = {
      authorization: `Bearer ${token}`,
    };
    let body: BodyInit | undefined;
    if (encoded.raw !== undefined) {
      headers['content-type'] = encoded.mediaType ?? 'application/octet-stream';
      body = encoded.raw as BodyInit;
    } else if (encoded.json !== undefined) {
      headers['content-type'] = 'application/json';
      body = encoded.json;
    }
    const response = await fetch(`${baseUrl}${encoded.path}`, {
      method: encoded.method,
      headers,
      body,
    });
    const bytes = new Uint8Array(await response.arrayBuffer());
    const answer = decodeHttpAnswer(route, parsed, response.status, bytes);
    return ROUTES[route].response.parse(answer) as RouteResponse<K>;
  },
});

/**
 * The event feed over `GET /v1/stream` (PROTOCOL §3.1): yields each stored event after `after`, and ends
 * when the signal aborts. An abort before the connection opens ends the feed at once.
 */
export const feedOf = async function* (
  baseUrl: string,
  after: number,
  signal?: AbortSignal,
  token: string = LOCAL_TEST_TOKEN,
): AsyncGenerator<StoredEvent> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/v1/stream?after=${after}`, {
      headers: { authorization: `Bearer ${token}` },
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    if (signal?.aborted) return;
    throw error;
  }
  if (!response.body) throw new Error('the stream has no body');
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  try {
    for (;;) {
      const chunk = await reader.read().catch(() => undefined);
      if (!chunk || chunk.done) return;
      buffer += chunk.value;
      for (
        let end = buffer.indexOf('\n\n');
        end >= 0;
        end = buffer.indexOf('\n\n')
      ) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const data = frame
          .split('\n')
          .filter((line) => line.startsWith('data: '))
          .map((line) => line.slice('data: '.length))
          .join('\n');
        if (data.length > 0) yield JSON.parse(data) as StoredEvent;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
};
