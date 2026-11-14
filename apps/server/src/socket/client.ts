import type {
  FactoryClient,
  FactoryFeed,
} from '@repo/factory-core/contracts/client';
import {
  WireFailure,
  wireErrorSchema,
  type WireError,
} from '@repo/factory-core/contracts/errors';
import {
  ROUTES,
  type RouteName,
  type RouteRequest,
  type RouteResponse,
} from '@repo/factory-core/contracts/routes';
import {
  storedEventSchema,
  type StoredEvent,
} from '@repo/factory-core/order/events';
import { API_PREFIX, STREAM_PATH } from './serve';

export interface SocketClientOptions {
  /** The socket to call: `$FACTORY_DATA_DIR/factory.sock`. */
  socketPath: string;
  /** Tries per call, for network failures and 5xx answers. The same body, so the same commandId. */
  attempts?: number;
  /** Pause between tries. */
  retryDelayMs?: number;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** A wire error from a body the server sent, or `unavailable` when the body is not one. */
const wireErrorOf = (body: unknown): WireError => {
  const parsed = wireErrorSchema.safeParse(body);
  return parsed.success ? parsed.data : { code: 'unavailable' };
};

/**
 * The socket client every local caller uses (PROTOCOL §2): the same routes and payloads as the
 * runtime's own client, carried over `factory.sock`. A request is validated before it is sent and
 * the answer is validated when it arrives. A refusal throws `WireFailure` with its wire error. Network
 * failures and 5xx answers are retried a bounded number of times with the same body; every command
 * carries its commandId, so a retry that the server already applied returns the stored response.
 *
 * `stream` reads the event feed (PROTOCOL §3.1). When the connection drops it reconnects from the
 * last globalSeq it yielded, so no event is skipped or repeated; it gives up after `attempts`
 * connection failures in a row.
 */
export const socketFactoryClient = (
  options: SocketClientOptions,
): FactoryClient & FactoryFeed => {
  const attempts = options.attempts ?? 3;
  const retryDelayMs = options.retryDelayMs ?? 100;

  const stream = async function* (
    afterGlobalSeq: number,
    signal?: AbortSignal,
  ): AsyncGenerator<StoredEvent> {
    let cursor = afterGlobalSeq;
    let failures = 0;
    while (!signal?.aborted) {
      let response: Response;
      try {
        response = await fetch(`http://factory${STREAM_PATH}?after=${cursor}`, {
          method: 'GET',
          unix: options.socketPath,
          headers: { accept: 'text/event-stream' },
          ...(signal ? { signal } : {}),
        } as RequestInit);
      } catch {
        if (signal?.aborted) return;
        failures += 1;
        if (failures >= attempts)
          throw new WireFailure({ code: 'unavailable' }, 503);
        await sleep(retryDelayMs);
        continue;
      }
      if (!response.ok || !response.body) {
        const payload: unknown = await response.json().catch(() => undefined);
        if (response.status >= 500) {
          failures += 1;
          if (failures >= attempts)
            throw new WireFailure(wireErrorOf(payload), response.status);
          await sleep(retryDelayMs);
          continue;
        }
        throw new WireFailure(wireErrorOf(payload), response.status);
      }
      failures = 0;

      const reader = response.body
        .pipeThrough(new TextDecoderStream())
        .getReader();
      let buffer = '';
      try {
        for (;;) {
          // A read error is a dropped connection: reconnect from the cursor below.
          const chunk = await reader.read().catch(() => undefined);
          if (!chunk || chunk.done) break;
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
            if (data.length === 0) continue;
            const event = storedEventSchema.parse(JSON.parse(data));
            cursor = event.globalSeq;
            yield event;
          }
        }
      } finally {
        await reader.cancel().catch(() => undefined);
      }
      if (signal?.aborted) return;
      await sleep(retryDelayMs);
    }
  };

  const call = async <K extends RouteName>(
    route: K,
    request: RouteRequest<K>,
  ): Promise<RouteResponse<K>> => {
    const definition = ROUTES[route];
    const body = JSON.stringify(definition.request.parse(request));
    const url = `http://factory${API_PREFIX}${definition.path}`;

    for (let attempt = 1; ; attempt += 1) {
      const last = attempt >= attempts;
      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          unix: options.socketPath,
          headers: { 'content-type': 'application/json' },
          body,
        } as RequestInit);
      } catch {
        if (last) throw new WireFailure({ code: 'unavailable' }, 503);
        await sleep(retryDelayMs);
        continue;
      }
      if (response.status >= 500 && !last) {
        await sleep(retryDelayMs);
        continue;
      }
      const payload: unknown = await response.json().catch(() => undefined);
      if (!response.ok) {
        throw new WireFailure(wireErrorOf(payload), response.status);
      }
      return definition.response.parse(payload) as RouteResponse<K>;
    }
  };

  return { call, stream };
};
