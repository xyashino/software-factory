import { Hono } from 'hono';
import {
  joinRequestSchema,
  joinResponseSchema,
} from '@repo/factory-core/contracts/cell';
import { invalidWire } from '@repo/factory-core/contracts/errors';
import {
  HTTP_ROUTES,
  type HttpAuth,
  type HttpRoute,
  type HttpRouteName,
} from '@repo/factory-core/contracts/http-routes';
import { ROUTES, type RouteName } from '@repo/factory-core/contracts/routes';
import type { CellId, JobId } from '@repo/factory-core/ids';
import type { Runtime } from '@repo/factory-runtime/composition';
import { streamResponse } from '../socket/serve';
import { failureResponse, jsonResponse, refusedResponse } from '../wire';

/**
 * The remote HTTP app (PROTOCOL §2, §3): the same runtime as the socket, served over TCP with Hono.
 * Every route comes from the core table `HTTP_ROUTES`, and every payload is parsed by the route's
 * shared zod schema, so the HTTP layer adds no command or scheduling logic of its own. Credentials
 * are checked per route before any body is read (PROTOCOL §1).
 */

/** Routes whose request schema names the Cell: the identity comes from the credential, never the body. */
const CELL_BODY_ROUTES: ReadonlySet<string> = new Set([
  'hello',
  'claim',
  'heartbeat',
  'submitCommand',
]);

/** A bearer token: the base64url alphabet, bounded in length. Anything else is no token. */
const BEARER = /^Bearer ([A-Za-z0-9_-]{1,512})$/;

type Caller =
  { kind: 'supervisor'; name: string } | { kind: 'cell'; cellId: CellId };

const bearerOf = (request: Request): string | undefined =>
  BEARER.exec(request.headers.get('authorization') ?? '')?.[1];

/** Who holds the token, among the credential classes the route accepts (PROTOCOL §1). */
const callerOf = async (
  runtime: Runtime,
  auth: HttpAuth,
  token: string,
): Promise<Caller | undefined> => {
  if (auth !== 'cell') {
    const name = await runtime.remote.supervisorName(token);
    if (name !== undefined) return { kind: 'supervisor', name };
  }
  if (auth !== 'supervisor' && auth !== 'join') {
    const cellId = await runtime.remote.cellOf(token);
    if (cellId !== undefined) return { kind: 'cell', cellId };
  }
  return undefined;
};

const NOT_JSON = Symbol('not json');

/** The JSON body of a request; an empty body is `{}`; NOT_JSON when the text does not parse. */
const readJson = async (
  request: Request,
): Promise<unknown | typeof NOT_JSON> => {
  const text = await request.text();
  if (text === '') return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return NOT_JSON;
  }
};

const notJson = () =>
  refusedResponse(invalidWire([{ path: [], message: 'the body is not JSON' }]));

/** One route: credential, path and body into the route's request, the runtime, the response. */
const serveRoute = async (
  runtime: Runtime,
  name: Exclude<HttpRouteName, 'join' | 'stream'>,
  request: Request,
  params: Readonly<Record<string, string>>,
): Promise<Response> => {
  const spec: HttpRoute = HTTP_ROUTES[name];
  const token = bearerOf(request);
  const caller =
    token === undefined ? undefined : await callerOf(runtime, spec.auth, token);
  if (!caller) return refusedResponse({ code: 'unauthorized' });

  const route: RouteName = name;
  const input: Record<string, unknown> = {};
  if (name === 'blobPut') {
    const bytes = new Uint8Array(await request.arrayBuffer());
    input.base64 = Buffer.from(bytes).toString('base64');
    input.mediaType = request.headers.get('content-type') ?? undefined;
  } else if (spec.method === 'POST') {
    const body = await readJson(request);
    if (body === NOT_JSON) return notJson();
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return refusedResponse(
        invalidWire([{ path: [], message: 'the body is not an object' }]),
      );
    }
    Object.assign(input, body);
  }
  for (const [param, field] of Object.entries(spec.params ?? {})) {
    input[field] = params[param];
  }

  if (caller.kind === 'cell' && CELL_BODY_ROUTES.has(name)) {
    if (input.cellId !== undefined && input.cellId !== caller.cellId) {
      return refusedResponse(
        invalidWire([
          { path: ['cellId'], message: 'does not match the credential' },
        ]),
      );
    }
    input.cellId = caller.cellId;
  }
  if (name === 'submitCommand') {
    const jobId = input.jobId as JobId;
    delete input.jobId;
    if (caller.kind !== 'cell')
      return refusedResponse({ code: 'unauthorized' });
    input.orderId = await runtime.remote.orderOfJob(caller.cellId, jobId);
  }

  const parsed = ROUTES[route].request.safeParse(input);
  if (!parsed.success) return refusedResponse(invalidWire(parsed.error.issues));

  try {
    const response = await runtime.call(route, parsed.data as never, {
      signal: request.signal,
    });
    if (name === 'claim' && (response as { job: unknown }).job === null) {
      return new Response(null, { status: 204 });
    }
    if (name === 'blobGet') {
      const { base64 } = response as { base64: string };
      return new Response(Buffer.from(base64, 'base64'), {
        status: 200,
        headers: { 'content-type': 'application/octet-stream' },
      });
    }
    return jsonResponse(200, ROUTES[route].response.parse(response));
  } catch (error) {
    return failureResponse(error, `${spec.method} ${spec.path}`);
  }
};

/**
 * The Hono app over one runtime. Every route of `HTTP_ROUTES` is registered; `join` and the SSE
 * stream are registered by hand, since neither is a socket route. An unknown path, and every socket
 * path, answers 404 `not_found` (PROTOCOL §3.5).
 */
export const createHttpApp = (runtime: Runtime): Hono => {
  const app = new Hono();
  app.notFound(() => refusedResponse({ code: 'not_found' }));

  app.on('POST', HTTP_ROUTES.join.path, async (c) => {
    try {
      const body = await readJson(c.req.raw);
      if (body === NOT_JSON) return notJson();
      const parsed = joinRequestSchema.safeParse(body);
      if (!parsed.success) {
        return refusedResponse(invalidWire(parsed.error.issues));
      }
      const joined = await runtime.remote.joinCell(parsed.data);
      return jsonResponse(200, joinResponseSchema.parse(joined));
    } catch (error) {
      return failureResponse(error, 'POST /v1/cell/join');
    }
  });

  app.on('GET', HTTP_ROUTES.stream.path, async (c) => {
    const token = bearerOf(c.req.raw);
    const caller =
      token === undefined
        ? undefined
        : await callerOf(runtime, HTTP_ROUTES.stream.auth, token);
    if (!caller) return refusedResponse({ code: 'unauthorized' });
    return streamResponse(runtime, c.req.raw);
  });

  for (const name of Object.keys(HTTP_ROUTES) as HttpRouteName[]) {
    if (name === 'join' || name === 'stream') continue;
    const spec = HTTP_ROUTES[name];
    app.on(spec.method, spec.path, (c) =>
      serveRoute(runtime, name, c.req.raw, c.req.param()),
    );
  }
  return app;
};
