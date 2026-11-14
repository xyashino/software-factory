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
import { API_PREFIX } from './serve';

export interface SocketClientOptions {
  /** The socket to call: `$FACTORY_DATA_DIR/factory.sock`. */
  socketPath: string;
  /** Tries per call, for network failures and 5xx answers. The same body, so the same commandId. */
  attempts?: number;
  /** Pause between tries. */
  retryDelayMs?: number;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** A wire error from a body the server sent, or `unavailable` when the body is not one. */
const wireErrorOf = (body: unknown): WireError => {
  const parsed = wireErrorSchema.safeParse(body);
  return parsed.success ? parsed.data : { code: 'unavailable' };
};

/**
 * The socket client every local caller uses (PROTOCOL §2): the same routes and payloads as the
 * runtime's own client, carried over `factory.sock`. A request is validated before it is sent and
 * the answer is validated when it arrives. A refusal throws `WireFailure` with its wire error. Network
 * failures and 5xx answers are retried a bounded number of times with the same body; every command
 * carries its commandId, so a retry that the server already applied returns the stored response.
 */
export const socketFactoryClient = (
  options: SocketClientOptions,
): FactoryClient => {
  const attempts = options.attempts ?? 3;
  const retryDelayMs = options.retryDelayMs ?? 100;

  const call = async <K extends RouteName>(
    route: K,
    request: RouteRequest<K>,
  ): Promise<RouteResponse<K>> => {
    const definition = ROUTES[route];
    const body = JSON.stringify(definition.request.parse(request));
    const url = `http://factory${API_PREFIX}${definition.path}`;

    for (let attempt = 1; ; attempt += 1) {
      const last = attempt >= attempts;
      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          unix: options.socketPath,
          headers: { 'content-type': 'application/json' },
          body,
        } as RequestInit);
      } catch {
        if (last) throw new WireFailure({ code: 'unavailable' }, 503);
        await sleep(retryDelayMs);
        continue;
      }
      if (response.status >= 500 && !last) {
        await sleep(retryDelayMs);
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
