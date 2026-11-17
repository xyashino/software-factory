import type { Hono } from 'hono';
import { HTTP_ROUTES } from '@repo/factory-core/contracts/http-routes';
import { invalidWire } from '@repo/factory-core/contracts/errors';
import type { StoredEvent } from '@repo/factory-core/order/events';
import type { TransportContext } from '../../../application/core/procedure';
import type { RuntimePort } from '../../../application/ports/runtime.port';
import { bearerOf } from '../adapter';
import { refusedResponse } from '../wire';

/** The event feed's path (PROTOCOL §3.1): `GET /v1/stream?after=<globalSeq>`, server-sent events. */
export const STREAM_PATH = HTTP_ROUTES.stream.path;

/**
 * How long the feed may stay quiet before the stream sends a keepalive comment. It must be well under
 * the listener's idle timeout (`IDLE_TIMEOUT_S`), so a quiet but live stream is never dropped.
 */
export const SSE_KEEPALIVE_MS = 15_000;

/** The keepalive line: an SSE comment, ignored by clients, that keeps the connection busy. */
export const SSE_KEEPALIVE = ': keepalive\n\n';

/**
 * The event feed as server-sent events (PROTOCOL §3.1): one `id` (the globalSeq) and one JSON `data`
 * line per stored event, from `after` or `Last-Event-ID`. While the feed is quiet, a keepalive comment
 * goes out every `keepaliveMs`. The stream ends when the client aborts. The caller checks the
 * credential first; this function only serves the feed.
 */
export const streamResponse = (
  runtime: RuntimePort,
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

/** `GET /v1/stream`: a supervisor credential, then the feed (PROTOCOL §3.1). */
export const mountStreamRoute = (
  app: Hono,
  transport: TransportContext,
): void => {
  app.get(STREAM_PATH, async (c) => {
    await transport.auth.authenticate(
      HTTP_ROUTES.stream.auth,
      bearerOf(c.req.raw),
    );
    return streamResponse(transport.runtime, c.req.raw);
  });
};
