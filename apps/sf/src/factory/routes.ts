import { z } from 'zod';
import {
  ActivitySchema,
  ScaleRequestBodySchema,
} from '@repo/factory-contracts/scale.contract';
import type { DaemonStatus } from '@repo/factory-contracts/status.contract';
import { RELAY_PATH, type Relay } from './relay';
import {
  ArgumentError,
  Refused,
  Unreachable,
} from '../application/core/errors';
import type { Ports } from '../application/core/procedure';
import { resolveCellTarget } from '../application/procedures/cell/resolve-project-target';
import type { HqLink } from './hq-link';
import type { Scaler } from './scaler';
import type { Supervisor } from './supervisor';

const OK = 200;
const BAD_REQUEST = 400;
const NOT_FOUND = 404;
const CONFLICT = 409;
const UNREACHABLE = 503;
const INTERNAL = 500;
const ACTIVITY_ROUTE = /^\/cells\/([^/]+)\/activity$/;

export interface RouteDeps {
  ports: Ports;
  supervisor: Supervisor;
  scaler: Scaler;
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

const parseOr = <T extends z.ZodTypeAny>(
  schema: T,
  raw: unknown,
): z.infer<T> => {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ArgumentError(parsed.error.message);
  }
  return parsed.data;
};

const scaleOf = async (
  deps: RouteDeps,
  request: Request,
): Promise<Response> => {
  const input = parseOr(ScaleRequestBodySchema, await readJson(request));
  const target = await resolveCellTarget(deps.ports, input.repoRoot);
  await deps.scaler.set({
    repoRoot: target.repoRoot,
    projectId: target.projectId,
    count: input.count,
    lines: input.lines,
  });
  return reply(OK, { projectId: target.projectId });
};

const activityOf = async (
  deps: RouteDeps,
  cellId: string,
  request: Request,
): Promise<Response> => {
  const input = parseOr(ActivitySchema, await readJson(request));
  if (!deps.supervisor.setActivity(cellId, input)) {
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
    return reply(OK, { projects: deps.scaler.status() });
  }
  if (request.method === 'PUT' && pathname === '/scale') {
    return scaleOf(deps, request);
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
