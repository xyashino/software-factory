import { hostname } from 'node:os';
import { z } from 'zod';
import {
  CELL_LINES_ENV,
  CLI_ENTRY,
  FACTORY_DAEMON_URL,
  FACTORY_PID_ENV,
  IS_COMPILED,
  JOIN_TOKEN_ENV,
  REPO_CONFIG_PATH,
  cellWorkerLauncherOf,
} from '../config';
import { cellNameOf } from '../domain/cell/cell-name';
import { joinPath } from '../domain/common/path';
import {
  ArgumentError,
  Refused,
  Unreachable,
} from '../application/core/errors';
import type { Ports } from '../application/core/procedure';
import { resolveCellTarget } from '../application/procedures/cell/resolve-project-target';
import type { DaemonStatus, HqState } from '../domain/factory/hq-state';
import type { HqLink } from './hq-link';
import { RELAY_PATH, type Relay } from './relay';
import type { CellRecord, Supervisor } from './supervisor';

const CREATED = 201;
const OK = 200;
const BAD_REQUEST = 400;
const NOT_FOUND = 404;
const CONFLICT = 409;
const UNREACHABLE = 503;
const INTERNAL = 500;
const CELL_ROUTE = /^\/cells\/([^/]+)$/;
const RELAY_URL = `${FACTORY_DAEMON_URL}${RELAY_PATH}`;
const cellLauncher = cellWorkerLauncherOf(IS_COMPILED, CLI_ENTRY);

const CreateSchema = z
  .object({
    repoRoot: z.string().min(1),
    lines: z.array(z.string().min(1)).min(1).optional(),
    name: z.string().min(1).optional(),
  })
  .strict();

export interface RouteDeps {
  ports: Ports;
  supervisor: Supervisor;
  hq: HqLink;
  relay: Relay;
  identity: { url: string; factoryId: string } | null;
}

const hqGateOf = (state: HqState): string | null => {
  switch (state.kind) {
    case 'ok':
      return null;
    case 'not_connected':
      return 'factory not connected: run "sf factory connect"';
    case 'unreachable':
      return 'HQ unreachable: no Cell starts until HQ answers';
    case 'rejected':
      return 'HQ rejected the credential: run "sf factory connect"';
  }
};

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

const readCreateBody = async (request: Request): Promise<unknown> => {
  try {
    return await request.json();
  } catch {
    throw new ArgumentError('body is not JSON');
  }
};

const workerEnvOf = (
  localToken: string,
  lines: readonly string[] | undefined,
): Record<string, string> => ({
  [FACTORY_PID_ENV]: String(process.pid),
  FACTORY_URL: RELAY_URL,
  FACTORY_TOKEN: localToken,
  // Blank, so a join token inherited from the daemon's env never reaches the Cell.
  [JOIN_TOKEN_ENV]: '',
  ...(lines === undefined ? {} : { [CELL_LINES_ENV]: lines.join(',') }),
});

// HQ failure is not reported: the HQ reaper deletes the Cell after its lease expires.
const goneInHq = async (deps: RouteDeps, hqCellId: string): Promise<void> => {
  const credential = deps.ports.factoryCredential.read();
  if (credential === null) {
    return;
  }
  await deps.ports.hq.goneCell({
    url: credential.url,
    sessionToken: credential.sessionToken,
    cellId: hqCellId,
  });
};

const createCell = async (
  deps: RouteDeps,
  raw: unknown,
): Promise<CellRecord> => {
  const parsed = CreateSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ArgumentError(parsed.error.message);
  }
  const input = parsed.data;
  const { ports } = deps;
  if (!(await ports.fs.exists(joinPath(input.repoRoot, REPO_CONFIG_PATH)))) {
    throw new ArgumentError(
      `${REPO_CONFIG_PATH} not found in ${input.repoRoot}, a Cell starts only inside a project repo`,
    );
  }
  const target = await resolveCellTarget(ports, {
    repoRoot: input.repoRoot,
    requested: undefined,
    choose: undefined,
    relayed: false,
  });
  const gate = hqGateOf(deps.hq.state());
  if (gate !== null) {
    throw new Refused(gate);
  }
  return deps.supervisor.spawn({
    repoRoot: target.repoRoot,
    name: input.name,
    baseName: cellNameOf(hostname()),
    start: async (name, cellId) => ({
      args: [...cellLauncher, 'cell', 'start', '--name', name],
      env: workerEnvOf(deps.relay.issue(cellId), input.lines),
    }),
  });
};

const handle = async (deps: RouteDeps, request: Request): Promise<Response> => {
  const { pathname } = new URL(request.url);
  const cellId = CELL_ROUTE.exec(pathname)?.[1];
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
  if (request.method === 'GET' && pathname === '/cells') {
    return reply(OK, { cells: deps.supervisor.list() });
  }
  if (request.method === 'POST' && pathname === '/cells') {
    const body = await readCreateBody(request);
    return reply(CREATED, await createCell(deps, body));
  }
  if (request.method === 'DELETE' && cellId !== undefined) {
    const id = decodeURIComponent(cellId);
    if (!(await deps.supervisor.kill(id))) {
      return failure(NOT_FOUND, 'not_found', `no cell ${id}`);
    }
    const hqCellId = deps.relay.hqCellIdOf(id);
    if (hqCellId !== null) {
      await goneInHq(deps, hqCellId);
    }
    return reply(OK, { cellId: id });
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
