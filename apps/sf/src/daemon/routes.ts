import { z } from 'zod';
import { REPO_CONFIG_PATH } from '../config';
import { joinPath } from '../domain/common/path';
import {
  ArgumentError,
  Refused,
  Unreachable,
} from '../application/core/errors';
import type { Ports } from '../application/core/procedure';
import type { DaemonStatus } from '../domain/factory/hq-state';
import type { HqLink } from './hq-link';
import { RELAY_PATH, type Relay } from './relay';
import type { Scale } from './scale';
import type { Supervisor } from './supervisor';

const OK = 200;
const BAD_REQUEST = 400;
const NOT_FOUND = 404;
const CONFLICT = 409;
const UNREACHABLE = 503;
const INTERNAL = 500;
const ACTIVITY_ROUTE = /^\/cells\/([^/]+)\/activity$/;

const ScaleSchema = z
  .object({
    repoRoot: z.string().min(1),
    projectId: z.string().min(1),
    lines: z.array(z.string().min(1)).min(1).optional(),
    count: z.number().int().min(0),
  })
  .strict();

const ActivitySchema = z
  .object({
    state: z.enum(['idle', 'running']),
    orderId: z.string().min(1).optional(),
    stationId: z.string().min(1).optional(),
    writes: z.boolean().optional(),
    since: z.number().int().min(0),
  })
  .strict();

export interface RouteDeps {
  ports: Ports;
  supervisor: Supervisor;
  scale: Scale;
  hq: HqLink;
  relay: Relay;
  identity: { url: string; factoryId: string } | null;
}

const reply = (status: number, body: unknown): Response =>
  Response.json(body, { status });

const failure = (status: number, type: string, message: string): Response =>
  reply(status, { code: status, type, message });

const errorReply = (error: unknown): Response => {
  if (error instanceof ArgumentError) {
    return failure(BAD_REQUEST, 'argument', error.message);
  }
  if (error instanceof Refused) {
    return failure(CONFLICT, 'refused', error.message);
  }
  if (error instanceof Unreachable) {
    return failure(UNREACHABLE, 'unreachable', error.message);
  }
  const message = error instanceof Error ? error.message : String(error);
  return failure(INTERNAL, 'internal', message);
};

const readJson = async (request: Request): Promise<unknown> => {
  try {
    return await request.json();
  } catch {
    throw new ArgumentError('body is not JSON');
  }
};

const scaleOf = async (deps: RouteDeps, raw: unknown): Promise<Response> => {
  const parsed = ScaleSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ArgumentError(parsed.error.message);
  }
  const input = parsed.data;
  if (
    !(await deps.ports.fs.exists(joinPath(input.repoRoot, REPO_CONFIG_PATH)))
  ) {
    throw new ArgumentError(
      `${REPO_CONFIG_PATH} not found in ${input.repoRoot}, a Cell starts only inside a project repo`,
    );
  }
  await deps.scale.set(input);
  return reply(OK, { projectId: input.projectId });
};

const activityOf = async (
  deps: RouteDeps,
  cellId: string,
  request: Request,
): Promise<Response> => {
  const parsed = ActivitySchema.safeParse(await readJson(request));
  if (!parsed.success) {
    throw new ArgumentError(parsed.error.message);
  }
  if (!deps.scale.report(cellId, parsed.data)) {
    return failure(NOT_FOUND, 'not_found', `no cell ${cellId}`);
  }
  return reply(OK, { cellId });
};

const handle = async (deps: RouteDeps, request: Request): Promise<Response> => {
  const { pathname } = new URL(request.url);
  const activityId = ACTIVITY_ROUTE.exec(pathname)?.[1];
  if (pathname === RELAY_PATH || pathname.startsWith(`${RELAY_PATH}/`)) {
    return deps.relay.handle(request);
  }
  if (request.method === 'GET' && pathname === '/health') {
    return reply(OK, { pid: process.pid });
  }
  if (request.method === 'GET' && pathname === '/status') {
    const status: DaemonStatus = {
      pid: process.pid,
      hq: deps.hq.state(),
      url: deps.identity?.url ?? null,
      factoryId: deps.identity?.factoryId ?? null,
      cells: deps.supervisor.list().length,
    };
    return reply(OK, status);
  }
  if (request.method === 'GET' && pathname === '/scale') {
    return reply(OK, { projects: deps.scale.list() });
  }
  if (request.method === 'PUT' && pathname === '/scale') {
    return scaleOf(deps, await readJson(request));
  }
  if (request.method === 'POST' && activityId !== undefined) {
    return activityOf(deps, decodeURIComponent(activityId), request);
  }
  return failure(
    NOT_FOUND,
    'not_found',
    `no route ${request.method} ${pathname}`,
  );
};

export const createFactoryRoutes =
  (deps: RouteDeps) =>
  async (request: Request): Promise<Response> => {
    try {
      return await handle(deps, request);
    } catch (error) {
      return errorReply(error);
    }
  };
