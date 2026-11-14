import { invalidWire } from '@repo/factory-core/contracts/errors';
import { ROUTES, routeByPath } from '@repo/factory-core/contracts/routes';
import type { StoredEvent } from '@repo/factory-core/order/events';
import type { Runtime } from '@repo/factory-runtime/composition';
import { failureResponse, jsonResponse, refusedResponse } from '../wire';

/** The path prefix of every route (PROTOCOL §3): `POST /v1/<route path>` with a JSON body. */
export const API_PREFIX = '/v1/';

/** The event feed's path (PROTOCOL §3.1): `GET /v1/stream?after=<globalSeq>`, server-sent events. */
export const STREAM_PATH = `${API_PREFIX}stream`;

/**
 * Answers one request on the socket (PROTOCOL §2). The route comes from the shared table; the body is
 * parsed by the route's request schema (422 `invalid` when it fails); the runtime answers, and the
 * answer is parsed by the response schema. A refusal keeps its status and its wire body. A failure
 * that is not a refusal answers 503 `unavailable`, so the client may retry with the same commandId.
 */
export const serveRequest = async (
  runtime: Runtime,
  request: Request,
): Promise<Response> => {
  const path = new URL(request.url).pathname;
  if (request.method === 'GET' && path === STREAM_PATH) {
    return streamResponse(runtime, request);
  }
  const route =
    request.method === 'POST' && path.startsWith(API_PREFIX)
      ? routeByPath(path.slice(API_PREFIX.length))
      : undefined;
  if (!route) return refusedResponse({ code: 'not_found' });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return refusedResponse(
      invalidWire([{ path: [], message: 'the body is not JSON' }]),
    );
  }
  const parsed = ROUTES[route].request.safeParse(body);
  if (!parsed.success) return refusedResponse(invalidWire(parsed.error.issues));

  try {
    const response = await runtime.call(route, parsed.data as never, {
      signal: request.signal,
    });
    return jsonResponse(200, ROUTES[route].response.parse(response));
  } catch (error) {
    return failureResponse(error, route);
  }
};

/**
 * How long the feed may stay quiet before the stream sends a keepalive comment. It must be well under
 * the TCP listener's idle timeout (`IDLE_TIMEOUT_S`), so a quiet but live stream is never dropped.
 */
export const SSE_KEEPALIVE_MS = 15_000;

/** The keepalive line: an SSE comment, ignored by clients, that keeps the connection busy. */
export const SSE_KEEPALIVE = ': keepalive\n\n';

/**
 * The event feed as server-sent events (PROTOCOL §3.1): one `id` (the globalSeq) and one JSON `data`
 * line per stored event, from `after` or `Last-Event-ID`. While the feed is quiet, a keepalive comment
 * goes out every `keepaliveMs`. The stream ends when the client aborts. The TCP listener serves the same
 * function, so both transports stream the same bytes.
 */
export const streamResponse = (
  runtime: Runtime,
  request: Request,
  keepaliveMs: number = SSE_KEEPALIVE_MS,
): Response => {
  const url = new URL(request.url);
  const raw =
    url.searchParams.get('after') ??
    request.headers.get('last-event-id') ??
    '0';
  const after = Number(raw);
  if (!Number.isInteger(after) || after < 0) {
    return refusedResponse(
      invalidWire([
        { path: ['after'], message: 'after must be a whole number' },
      ]),
    );
  }
  const encoder = new TextEncoder();
  const events = runtime.feed(after, request.signal)[Symbol.asyncIterator]();
  // One read may be in flight when a keepalive fires; it is kept and awaited by the next pull, never
  // read twice, so no event is skipped or sent out of order.
  let pending: Promise<IteratorResult<StoredEvent>> | undefined;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      pending ??= events.next();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const quiet = new Promise<'quiet'>((resolve) => {
        timer = setTimeout(() => resolve('quiet'), keepaliveMs);
      });
      const won = await Promise.race([pending, quiet]);
      clearTimeout(timer);
      if (cancelled) return;
      if (won === 'quiet') {
        controller.enqueue(encoder.encode(SSE_KEEPALIVE));
        return;
      }
      pending = undefined;
      if (won.done) {
        controller.close();
        return;
      }
      controller.enqueue(
        encoder.encode(
          `id: ${won.value.globalSeq}\ndata: ${JSON.stringify(won.value)}\n\n`,
        ),
      );
    },
    cancel() {
      cancelled = true;
      void events.return?.(undefined);
    },
  });
  return new Response(body, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
    },
  });
};
