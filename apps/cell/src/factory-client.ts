import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { FactoryClient } from '@repo/factory-core/contracts/client';
import {
  WireFailure,
  wireErrorSchema,
  type WireError,
} from '@repo/factory-core/contracts/errors';
import {
  ROUTES,
  type RouteName,
  type RouteRequest,
  type RouteResponse,
} from '@repo/factory-core/contracts/routes';
import type { CellId, OrderId } from '@repo/factory-core/ids';
import type { OrderCommand } from '@repo/factory-core/order/commands';

export type { FactoryClient } from '@repo/factory-core/contracts/client';

/** The path prefix of every route (PROTOCOL §3). Mirrors the server's `API_PREFIX`; a Cell cannot import the server. */
export const API_PREFIX = '/v1/';

/** The socket inside the data directory (PROTOCOL §2). */
export const SOCKET_FILE_NAME = 'factory.sock';

/** `$FACTORY_DATA_DIR`, else `~/.local/share/factory` (STORAGE §1). */
export const factoryDataDirOf = (env: NodeJS.ProcessEnv): string =>
  env.FACTORY_DATA_DIR ?? join(homedir(), '.local', 'share', 'factory');

/** The socket inside a Factory data directory (PROTOCOL §2). */
export const socketPathIn = (dataDir: string): string =>
  join(dataDir, SOCKET_FILE_NAME);

export interface SocketClientOptions {
  /** The socket to call: `$FACTORY_DATA_DIR/factory.sock`. */
  socketPath: string;
  /** Tries per call for network failures and 5xx answers. The same body, so the same commandId. */
  attempts?: number;
  /** First pause between tries; it doubles each try up to `maxDelayMs`. */
  baseDelayMs?: number;
  maxDelayMs?: number;
  /**
   * Caller-supplied retry deadline (epoch ms). A retry whose pause would end at or after it is not
   * made: the call throws `WireFailure{unavailable,503}` instead. Bounds retries in time, not only in count.
   */
  retryUntil?: number;
  /** Replaces `fetch`, so tests can script the socket's answers. */
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
  /** Replaces the pause, so tests do not wait. */
  sleep?: (ms: number) => Promise<void>;
  /** Replaces the clock read against `retryUntil`, so tests are deterministic. */
  now?: () => number;
}

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** A wire error from a body the server sent, or `unavailable` when the body is not one. */
const wireErrorOf = (body: unknown): WireError => {
  const parsed = wireErrorSchema.safeParse(body);
  return parsed.success ? parsed.data : { code: 'unavailable' };
};

/**
 * The socket client every Cell call uses (PROTOCOL §2). It implements the transport-neutral
 * `FactoryClient` over `factory.sock`: each request is validated against its route before it is sent,
 * each answer after it arrives. A refusal (4xx, including 401 `unauthorized`) throws `WireFailure` at
 * once. A network failure or a 5xx answer is retried with the same body and an exponential pause; when
 * the budget runs out it throws `WireFailure{unavailable}`. This client never opens `factory-db`.
 */
export const socketFactoryClient = (
  options: SocketClientOptions,
): FactoryClient => {
  const attempts = options.attempts ?? 5;
  const baseDelayMs = options.baseDelayMs ?? 100;
  const maxDelayMs = options.maxDelayMs ?? 2_000;
  const fetchImpl =
    options.fetchImpl ?? ((url: string, init: RequestInit) => fetch(url, init));
  const sleep = options.sleep ?? wait;
  const now = options.now ?? Date.now;
  const { retryUntil } = options;

  const call = async <K extends RouteName>(
    route: K,
    request: RouteRequest<K>,
  ): Promise<RouteResponse<K>> => {
    const definition = ROUTES[route];
    const body = JSON.stringify(definition.request.parse(request));
    const url = `http://factory${API_PREFIX}${definition.path}`;

    for (let attempt = 1; ; attempt += 1) {
      const pause = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      // No further try once the attempt budget or the caller's deadline is spent.
      const last =
        attempt >= attempts ||
        (retryUntil !== undefined && now() + pause >= retryUntil);
      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: 'POST',
          unix: options.socketPath,
          headers: { 'content-type': 'application/json' },
          body,
        } as RequestInit);
      } catch {
        if (last) throw new WireFailure({ code: 'unavailable' }, 503);
        await sleep(pause);
        continue;
      }
      if (response.status >= 500) {
        if (last) throw new WireFailure({ code: 'unavailable' }, 503);
        await sleep(pause);
        continue;
      }
      const payload: unknown = await response.json().catch(() => undefined);
      if (!response.ok) {
        throw new WireFailure(wireErrorOf(payload), response.status);
      }
      return definition.response.parse(payload) as RouteResponse<K>;
    }
  };

  return { call };
};

/** The parts of a command that name it: the same content always gives the same commandId. */
export interface CommandIdInput {
  cellId: CellId;
  orderId: OrderId;
  epoch: number;
  command: OrderCommand;
}

/** Recursively sorts object keys, so the same value always serialises to the same text. */
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [
          key,
          canonical((value as Record<string, unknown>)[key]),
        ]),
    );
  }
  return value;
};

/**
 * The content-derived commandId (retry-safe): sha256 hex of the canonical JSON of the command's
 * identity. A retry of the same content reuses the id, so the server returns the stored answer; a
 * different command (another type, another cycle) gets another id.
 */
export const commandIdOf = (input: CommandIdInput): string =>
  createHash('sha256')
    .update(
      JSON.stringify(
        canonical({
          cellId: input.cellId,
          orderId: input.orderId,
          epoch: input.epoch,
          command: input.command,
        }),
      ),
    )
    .digest('hex')
    .slice(0, 128);
