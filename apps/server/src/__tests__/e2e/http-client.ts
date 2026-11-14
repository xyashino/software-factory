import type { FactoryClient } from '@repo/factory-core/contracts/client';
import { WireFailure } from '@repo/factory-core/contracts/errors';
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

/**
 * A FactoryClient over the remote HTTP routes, for the tests only. It is the same shape as the CLI
 * and Cell clients: the shared codec encodes each call and reads each answer, and `fetch` carries
 * it with the bearer token. `stream` reads the SSE feed.
 */
export interface HttpFactoryClient extends FactoryClient {
  stream(
    afterGlobalSeq: number,
    signal?: AbortSignal,
  ): AsyncIterable<StoredEvent>;
}

export const httpFactoryClient = (options: {
  baseUrl: string;
  token: string;
}): HttpFactoryClient => {
  const authorization = `Bearer ${options.token}`;

  const call = async <K extends RouteName>(
    route: K,
    request: RouteRequest<K>,
  ): Promise<RouteResponse<K>> => {
    const parsed = ROUTES[route].request.parse(request) as RouteRequest<K>;
    const encoded = encodeHttpCall(route, parsed);
    const headers: Record<string, string> = { authorization };
    let body: BodyInit | undefined;
    if (encoded.raw !== undefined) {
      headers['content-type'] = encoded.mediaType ?? 'application/octet-stream';
      body = encoded.raw as BodyInit;
    } else if (encoded.json !== undefined) {
      headers['content-type'] = 'application/json';
      body = encoded.json;
    }
    const response = await fetch(`${options.baseUrl}${encoded.path}`, {
      method: encoded.method,
      headers,
      body,
    });
    const bytes = new Uint8Array(await response.arrayBuffer());
    const answer = decodeHttpAnswer(route, parsed, response.status, bytes);
    return ROUTES[route].response.parse(answer) as RouteResponse<K>;
  };

  const stream = async function* (
    afterGlobalSeq: number,
    signal?: AbortSignal,
  ): AsyncGenerator<StoredEvent> {
    const response = await fetch(
      `${options.baseUrl}/v1/stream?after=${afterGlobalSeq}`,
      { headers: { authorization }, signal },
    );
    if (!response.body) throw new WireFailure({ code: 'unavailable' });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffered = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buffered += decoder.decode(value, { stream: true });
        let end = buffered.indexOf('\n\n');
        while (end !== -1) {
          const block = buffered.slice(0, end);
          buffered = buffered.slice(end + 2);
          const data = block
            .split('\n')
            .find((line) => line.startsWith('data: '));
          if (data)
            yield JSON.parse(data.slice('data: '.length)) as StoredEvent;
          end = buffered.indexOf('\n\n');
        }
      }
    } catch (error) {
      if (signal?.aborted) return;
      throw error;
    } finally {
      reader.releaseLock();
    }
  };

  return { call, stream };
};
