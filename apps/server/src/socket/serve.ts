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

/** A Zod failure raised while the runtime parsed an internal payload, by its shape. */
const isIssueError = (
  error: unknown,
): error is { issues: { path: PropertyKey[]; message: string }[] } =>
  error instanceof Error &&
  Array.isArray((error as { issues?: unknown }).issues);
