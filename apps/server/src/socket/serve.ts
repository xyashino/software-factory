import {
  invalidWire,
  WIRE_STATUS,
  type WireError,
} from '@repo/factory-core/contracts/errors';
import { ROUTES, routeByPath } from '@repo/factory-core/contracts/routes';
import type { Runtime } from '@repo/factory-runtime/composition';
import { isRuntimeError } from '@repo/factory-runtime/errors';

/** The path prefix of every route (PROTOCOL §3): `POST /v1/<route path>` with a JSON body. */
export const API_PREFIX = '/v1/';

/** The event feed's path (PROTOCOL §3.1): `GET /v1/stream?after=<globalSeq>`, server-sent events. */
export const STREAM_PATH = `${API_PREFIX}stream`;

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const refused = (error: WireError): Response =>
  json(WIRE_STATUS[error.code], error);

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
  if (!route) return refused({ code: 'not_found' });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return refused(
      invalidWire([{ path: [], message: 'the body is not JSON' }]),
    );
  }
  const parsed = ROUTES[route].request.safeParse(body);
  if (!parsed.success) return refused(invalidWire(parsed.error.issues));

  try {
    const response = await runtime.call(route, parsed.data as never, {
      signal: request.signal,
    });
    return json(200, ROUTES[route].response.parse(response));
  } catch (error) {
    if (isRuntimeError(error)) return refused(error.wire);
    if (isIssueError(error)) {
      return refused(invalidWire(error.issues));
    }
    console.error(`factory-server: ${route} failed`, error);
    return refused({ code: 'unavailable' });
  }
};

/**
 * The event feed as server-sent events (PROTOCOL §3.1): one `id` (the globalSeq) and one JSON `data`
 * line per stored event, from `after` or `Last-Event-ID`. The stream ends when the client aborts.
 */
export const streamResponse = (
  runtime: Runtime,
  request: Request,
): Response => {
  const url = new URL(request.url);
  const raw =
    url.searchParams.get('after') ??
    request.headers.get('last-event-id') ??
    '0';
  const after = Number(raw);
  if (!Number.isInteger(after) || after < 0) {
    return refused(
      invalidWire([
        { path: ['after'], message: 'after must be a whole number' },
      ]),
    );
  }
  const encoder = new TextEncoder();
  const events = runtime.feed(after, request.signal)[Symbol.asyncIterator]();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await events.next();
      if (next.done) {
        controller.close();
        return;
      }
      controller.enqueue(
        encoder.encode(
          `id: ${next.value.globalSeq}\ndata: ${JSON.stringify(next.value)}\n\n`,
        ),
      );
    },
    cancel() {
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

/** A Zod failure raised while the runtime parsed an internal payload, by its shape. */
const isIssueError = (
  error: unknown,
): error is { issues: { path: PropertyKey[]; message: string }[] } =>
  error instanceof Error &&
  Array.isArray((error as { issues?: unknown }).issues);
