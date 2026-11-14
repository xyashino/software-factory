import type { RouteName } from './routes';

/**
 * The remote HTTP surface (PROTOCOL §3.1, §3.2). `ROUTES` keeps the socket paths; this table is the
 * one place that maps each route to its HTTP method, path and credential. The server registers its
 * Hono routes from it, and the remote clients build their URLs from it, so every path is written once.
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

/** Who may call a route (PROTOCOL §1): a supervisor token, a Cell credential, or either. */
export type HttpAuth = 'supervisor' | 'cell' | 'supervisor_or_cell' | 'join';

export interface HttpRoute {
  readonly method: HttpMethod;
  /** A path with `:name` parameters, each filled by `params`. */
  readonly path: string;
  readonly auth: HttpAuth;
  /** Path parameter -> request field it fills (`:id` -> `orderId`). */
  readonly params?: Readonly<Record<string, string>>;
}

/** Routes with no `ROUTES` entry: the join call, and the SSE stream that replaces `supervisorEvents`. */
export const HTTP_EXTRA_ROUTES = {
  join: { method: 'POST', path: '/v1/cell/join', auth: 'join' },
  stream: { method: 'GET', path: '/v1/stream', auth: 'supervisor' },
} as const satisfies Record<string, HttpRoute>;

/**
 * Socket routes with no HTTP route, and why. A route listed here answers 404 over HTTP: the test
 * for this table fails if a `ROUTES` key is neither mapped nor listed.
 */
export const HTTP_UNMAPPED = {
  supervisorEvents:
    'replaced by GET /v1/stream (server-sent events, Last-Event-ID = globalSeq)',
  adminBackup:
    'host-side only: it writes to the server filesystem; run `factory-server admin backup` on the host',
} as const satisfies Partial<Record<RouteName, string>>;

export type UnmappedRoute = keyof typeof HTTP_UNMAPPED;
export type MappedRoute = Exclude<RouteName, UnmappedRoute>;
export type HttpRouteName = MappedRoute | keyof typeof HTTP_EXTRA_ROUTES;

/** The HTTP route of every mapped socket route, and the extra ones (PROTOCOL §3.1, §3.2). */
export const HTTP_ROUTES = {
  board: { method: 'GET', path: '/v1/board', auth: 'supervisor' },
  orderDetail: {
    method: 'GET',
    path: '/v1/orders/:id',
    auth: 'supervisor',
    params: { id: 'orderId' },
  },
  answer: {
    method: 'POST',
    path: '/v1/orders/:id/answer',
    auth: 'supervisor',
    params: { id: 'orderId' },
  },
  resume: {
    method: 'POST',
    path: '/v1/orders/:id/resume',
    auth: 'supervisor',
    params: { id: 'orderId' },
  },
  reopen: {
    method: 'POST',
    path: '/v1/orders/:id/reopen',
    auth: 'supervisor',
    params: { id: 'orderId' },
  },
  nudge: {
    method: 'POST',
    path: '/v1/orders/:id/nudge',
    auth: 'supervisor',
    params: { id: 'orderId' },
  },
  cancel: {
    method: 'POST',
    path: '/v1/orders/:id/cancel',
    auth: 'supervisor',
    params: { id: 'orderId' },
  },
  reprioritise: {
    method: 'POST',
    path: '/v1/orders/:id/priority',
    auth: 'supervisor',
    params: { id: 'orderId' },
  },
  intakeSync: {
    method: 'POST',
    path: '/v1/intake/sync',
    auth: 'supervisor',
  },
  cellsList: { method: 'GET', path: '/v1/cells', auth: 'supervisor' },
  cellRevoke: {
    method: 'DELETE',
    path: '/v1/cells/:id',
    auth: 'supervisor',
    params: { id: 'cellId' },
  },
  joinTokenCreate: {
    method: 'POST',
    path: '/v1/join-tokens',
    auth: 'supervisor',
  },
  joinTokenList: {
    method: 'GET',
    path: '/v1/join-tokens',
    auth: 'supervisor',
  },
  joinTokenRevoke: {
    method: 'DELETE',
    path: '/v1/join-tokens/:id',
    auth: 'supervisor',
    params: { id: 'joinTokenId' },
  },
  adminExport: {
    method: 'GET',
    path: '/v1/admin/export',
    auth: 'supervisor',
  },
  adminRebuildProjections: {
    method: 'POST',
    path: '/v1/admin/rebuild-projections',
    auth: 'supervisor',
  },
  hello: { method: 'POST', path: '/v1/cell/hello', auth: 'cell' },
  claim: { method: 'POST', path: '/v1/cell/claim', auth: 'cell' },
  heartbeat: { method: 'POST', path: '/v1/cell/heartbeat', auth: 'cell' },
  submitCommand: {
    method: 'POST',
    path: '/v1/cell/jobs/:jobId/commands',
    auth: 'cell',
    params: { jobId: 'jobId' },
  },
  blobGet: {
    method: 'GET',
    path: '/v1/blobs/:ref',
    auth: 'supervisor_or_cell',
    params: { ref: 'ref' },
  },
  blobPut: {
    method: 'PUT',
    path: '/v1/blobs/:ref',
    auth: 'cell',
    params: { ref: 'ref' },
  },
  ...HTTP_EXTRA_ROUTES,
} as const satisfies Record<HttpRouteName, HttpRoute>;

/**
 * The URL path of a route with its parameters filled. Values are percent-encoded per segment, so a
 * blob ref (`sha256:<hex>`) or an id can never add a segment.
 */
export const httpPath = (
  route: HttpRouteName,
  values: Readonly<Record<string, string>> = {},
): string =>
  HTTP_ROUTES[route].path.replace(/:([A-Za-z]+)/g, (_, name: string) => {
    const value = values[name];
    if (value === undefined) {
      throw new Error(`httpPath(${route}): missing path parameter ${name}`);
    }
    return encodeURIComponent(value);
  });
