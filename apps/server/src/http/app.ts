import { createHash, timingSafeEqual } from 'node:crypto';
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
import { isPlanId, type JobId } from '@repo/factory-core/ids';
import type { Runtime } from '@repo/factory-runtime/composition';
import { isRuntimeError } from '@repo/factory-runtime/errors';
import { failureResponse, jsonResponse, refusedResponse } from '../wire';
import { type AuthCache, type Caller, createAuthCache } from './auth-cache';
import { serveGithubWebhook } from './github-webhook';
import { streamResponse } from './stream';

/**
 * The HTTP app (PROTOCOL §2, §3): the runtime served over Hono, for local and remote clients alike.
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

const bearerOf = (request: Request): string | undefined =>
  BEARER.exec(request.headers.get('authorization') ?? '')?.[1];

/** Whether a route's credential classes (PROTOCOL §1) admit a caller of this kind. */
const admits = (auth: HttpAuth, caller: Caller): boolean => {
  if (caller.kind === 'supervisor') {
    return auth === 'local'
      ? caller.name === LOCAL_SUPERVISOR_NAME
      : auth !== 'cell';
  }
  return auth !== 'supervisor' && auth !== 'join' && auth !== 'local';
};

/** The name a local client's supervisor token carries: the server's own, not a stored token's. */
export const LOCAL_SUPERVISOR_NAME = 'local';

/** Constant-time equality of two tokens, so a wrong guess reveals nothing about the right one. */
const sameToken = (a: string, b: string): boolean => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

/**
 * Who holds the token, among the credential classes the route accepts (PROTOCOL §1). The local
 * supervisor token is checked first, in memory: it is never stored, so no revoke is needed when the
 * server stops. Everything else is a runtime lookup.
 */
const lookupCaller = async (
  runtime: Runtime,
  auth: HttpAuth,
  token: string,
  localToken: string | undefined,
): Promise<Caller | undefined> => {
  const isLocal = localToken !== undefined && sameToken(token, localToken);
  if (auth === 'local') {
    return isLocal
      ? { kind: 'supervisor', name: LOCAL_SUPERVISOR_NAME }
      : undefined;
  }
  if (auth !== 'cell') {
    if (isLocal) return { kind: 'supervisor', name: LOCAL_SUPERVISOR_NAME };
    const name = await runtime.remote.supervisorName(token);
    if (name !== undefined) return { kind: 'supervisor', name };
  }
  if (auth !== 'supervisor' && auth !== 'join') {
    const cellId = await runtime.remote.cellOf(token);
    if (cellId !== undefined) return { kind: 'cell', cellId };
  }
  return undefined;
};

/**
 * Who holds the token (PROTOCOL §1), through the auth cache (perf-04): a verified caller the route
 * admits is served from memory; otherwise the runtime checks the credential and a positive result is
 * cached under the token's digest. A refusal is never cached.
 */
const callerOf = async (
  runtime: Runtime,
  cache: AuthCache,
  auth: HttpAuth,
  token: string,
  localToken: string | undefined,
): Promise<Caller | undefined> => {
  const digest = createHash('sha256').update(token).digest('hex');
  const cached = cache.get(digest, Date.now());
  if (cached !== undefined && admits(auth, cached)) return cached;
  const generation = cache.generation();
  const caller = await lookupCaller(runtime, auth, token, localToken);
  if (caller !== undefined) cache.set(digest, caller, generation, Date.now());
  return caller;
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
  cache: AuthCache,
  localToken: string | undefined,
  name: Exclude<HttpRouteName, 'join' | 'stream' | 'githubWebhook'>,
  request: Request,
  params: Readonly<Record<string, string>>,
): Promise<Response> => {
  const spec: HttpRoute = HTTP_ROUTES[name];
  const token = bearerOf(request);
  const caller =
    token === undefined
      ? undefined
      : await callerOf(runtime, cache, spec.auth, token, localToken);
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
    // The Cell's lease names the Work order of its job. A job whose lease is gone keeps the order the body
    // names: the runtime's epoch guard then refuses the command with stale_epoch (PROTOCOL §11).
    const held = await runtime.remote
      .orderOfJob(caller.cellId, jobId)
      .catch((error: unknown) => {
        if (isRuntimeError(error) && error.wire.code === 'not_found') {
          return undefined;
        }
        throw error;
      });
    // A plan job's lease names its plan, so the body carries `planId` for that variant (PROTOCOL §4).
    if (held !== undefined) {
      if (isPlanId(held)) input.planId = held;
      else input.orderId = held;
    }
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
 * The Hono app over one runtime. Every route of `HTTP_ROUTES` is registered; `join`, the SSE stream
 * and the GitHub webhook are registered by hand, since none is a bearer-authed route. An unknown path
 * answers 404 `not_found` (PROTOCOL §3.5).
 */
export const createHttpApp = (
  runtime: Runtime,
  options: { githubWebhookSecret?: string; localToken?: string } = {},
): Hono => {
  const localToken = options.localToken;
  const app = new Hono();
  app.notFound(() => refusedResponse({ code: 'not_found' }));
  // Verified credentials are cached for this app; every revoke, from any caller, drops its entries.
  const cache = createAuthCache();
  runtime.remote.onRevoked((revocation) => {
    if (revocation.kind === 'cell') cache.evictCell(revocation.cellId);
    else cache.clear();
  });

  app.on('POST', HTTP_ROUTES.githubWebhook.path, (c) =>
    serveGithubWebhook(runtime, c.req.raw, options.githubWebhookSecret),
  );

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
        : await callerOf(
            runtime,
            cache,
            HTTP_ROUTES.stream.auth,
            token,
            localToken,
          );
    if (!caller) return refusedResponse({ code: 'unauthorized' });
    return streamResponse(runtime, c.req.raw);
  });

  for (const name of Object.keys(HTTP_ROUTES) as HttpRouteName[]) {
    if (name === 'join' || name === 'stream' || name === 'githubWebhook') {
      continue;
    }
    const spec = HTTP_ROUTES[name];
    app.on(spec.method, spec.path, (c) =>
      serveRoute(runtime, cache, localToken, name, c.req.raw, c.req.param()),
    );
  }
  return app;
};
