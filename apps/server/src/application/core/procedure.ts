import { invalidWire } from '@repo/factory-core/contracts/errors';
import {
  HTTP_ROUTES,
  type HttpAuth,
  type HttpMethod,
  type HttpRoute,
  type HttpRouteName,
} from '@repo/factory-core/contracts/http-routes';
import { ROUTES } from '@repo/factory-core/contracts/routes';
import type { AuthPort, Caller } from '../ports/auth.port';
import type { RuntimePort } from '../ports/runtime.port';
import { RefusalError } from './error-handling';
import { withRouteSchema } from './schema/zod';

/**
 * The procedure layer (PROTOCOL §3): one procedure per HTTP route, transport-neutral. A procedure
 * receives the request as data (path params, the body, the verified caller) and answers with a
 * `ProcedureOutput`; an adapter turns both into HTTP. Access tiers come from `HTTP_ROUTES`, so the
 * credential a route needs is written once.
 */

/** The shared dependencies of every procedure. */
export interface TransportContext {
  readonly runtime: RuntimePort;
  readonly auth: AuthPort;
}

export type BodyMode = 'none' | 'json' | 'text' | 'bytes';

export type RequestBody =
  | { kind: 'none' }
  | { kind: 'json'; value: unknown }
  | { kind: 'text'; text: string }
  | { kind: 'bytes'; bytes: Uint8Array };

/** The request as a transport delivers it, after the credential check. */
export interface Incoming {
  readonly params: Readonly<Record<string, string>>;
  readonly body: RequestBody;
  readonly headers: Headers;
  readonly caller: Caller | undefined;
  readonly signal: AbortSignal | undefined;
}

/** What a handler receives: the incoming request, and its input (path params, then the body's fields). */
export interface Call extends Incoming {
  readonly input: Readonly<Record<string, unknown>>;
}

export type ProcedureOutput =
  | { kind: 'empty' }
  | { kind: 'json'; body: unknown }
  | { kind: 'bytes'; bytes: Uint8Array; mediaType: string };

export type Handler = (
  call: Call,
  transport: TransportContext,
) => Promise<ProcedureOutput>;

export interface Procedure<N extends HttpRouteName = HttpRouteName> {
  readonly name: N;
  readonly method: HttpMethod;
  readonly path: string;
  readonly auth: HttpAuth;
  readonly body: BodyMode;
  readonly run: (
    incoming: Incoming,
    transport: TransportContext,
  ) => Promise<ProcedureOutput>;
}

/** The routes that run a `ROUTES` operation: every route but the join call, the stream and the webhook. */
export type RouteHttpName = Exclude<
  HttpRouteName,
  'join' | 'stream' | 'githubWebhook'
>;

type NamesWith<A extends HttpAuth> = {
  [K in HttpRouteName]: (typeof HTTP_ROUTES)[K]['auth'] extends A ? K : never;
}[HttpRouteName];

const isRouteHttpName = (name: HttpRouteName): name is RouteHttpName =>
  name !== 'join' && name !== 'stream' && name !== 'githubWebhook';

export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const bodyModeOf = (method: HttpMethod): BodyMode =>
  method === 'POST' ? 'json' : 'none';

/** The input of a request: the body's fields when it is an object, then the path params. */
const inputOf = (
  spec: HttpRoute,
  incoming: Incoming,
): Record<string, unknown> => {
  const input: Record<string, unknown> = {};
  if (incoming.body.kind === 'json' && isObject(incoming.body.value)) {
    Object.assign(input, incoming.body.value);
  }
  for (const [param, field] of Object.entries(spec.params ?? {})) {
    input[field] = incoming.params[param];
  }
  return input;
};

/** Builds a procedure from its route: method, path and access come from `HTTP_ROUTES`. */
export const defineProcedure = <N extends HttpRouteName>(
  name: N,
  handle: Handler,
  body: BodyMode = bodyModeOf(HTTP_ROUTES[name].method),
): Procedure<N> => {
  const spec: HttpRoute = HTTP_ROUTES[name];
  return {
    name,
    method: spec.method,
    path: spec.path,
    auth: spec.auth,
    body,
    run: (incoming, transport) =>
      handle({ ...incoming, input: inputOf(spec, incoming) }, transport),
  };
};

/** The body of a route that takes an object: refused with `invalid` when it is any other JSON. */
export const routeInput = (call: Call): Record<string, unknown> => {
  if (call.body.kind === 'json' && !isObject(call.body.value)) {
    throw new RefusalError(
      invalidWire([{ path: [], message: 'the body is not an object' }]),
    );
  }
  return { ...call.input };
};

/** Parses the input with the route's schema, then runs the route on the runtime. */
export const callRoute = (
  route: RouteHttpName,
  input: Readonly<Record<string, unknown>>,
  transport: TransportContext,
  signal: AbortSignal | undefined,
): Promise<unknown> => {
  const parsed = withRouteSchema(route)(input);
  return transport.runtime.call(route, parsed as never, { signal });
};

/** The JSON answer of a route: its response is parsed by the route's schema. */
export const replyOf = (
  route: RouteHttpName,
  response: unknown,
): ProcedureOutput => ({
  kind: 'json',
  body: ROUTES[route].response.parse(response),
});

/** The handler of a plain route: its input goes to the runtime and its answer is returned as JSON. */
export const plainRoute = (name: HttpRouteName): Handler => {
  if (!isRouteHttpName(name)) {
    throw new Error(`${name} has no ROUTES operation: it needs a handler`);
  }
  const route = name;
  return async (call, transport) =>
    replyOf(
      route,
      await callRoute(route, routeInput(call), transport, call.signal),
    );
};

export const publicProcedure = <N extends NamesWith<'join' | 'webhook'>>(
  name: N,
  handle: Handler,
  body?: BodyMode,
): Procedure<N> => defineProcedure(name, handle, body);

export const supervisorProcedure = <N extends NamesWith<'supervisor'>>(
  name: N,
  handle?: Handler,
  body?: BodyMode,
): Procedure<N> => defineProcedure(name, handle ?? plainRoute(name), body);

export const localSupervisorProcedure = <N extends NamesWith<'local'>>(
  name: N,
  handle?: Handler,
  body?: BodyMode,
): Procedure<N> => defineProcedure(name, handle ?? plainRoute(name), body);

export const cellProcedure = <N extends NamesWith<'cell'>>(
  name: N,
  handle?: Handler,
  body?: BodyMode,
): Procedure<N> => defineProcedure(name, handle ?? plainRoute(name), body);

export const supervisorOrCellProcedure = <
  N extends NamesWith<'supervisor_or_cell'>,
>(
  name: N,
  handle?: Handler,
  body?: BodyMode,
): Procedure<N> => defineProcedure(name, handle ?? plainRoute(name), body);
