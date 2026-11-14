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

/** The path prefix of every route on the socket (PROTOCOL §3). */
export const API_PREFIX = '/v1/';

export interface SocketClientOptions {
  /** The socket to call: `<data-dir>/factory.sock`. */
  socketPath: string;
  /** Tries per call, for network failures and 5xx answers. The same body, so the same commandId. */
  attempts?: number;
  /** Pause between tries. */
  retryDelayMs?: number;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The socket could not be reached: no file, no listener, or a broken connection on every try. The
 * transport reads it as "no server answers here" and may run a one-shot instead. A server that
 * answers with an error is a different failure, and it is not this one.
 */
export class SocketUnreachable extends Error {
  constructor(socketPath: string) {
    super(`factory.sock at ${socketPath} does not answer`);
    this.name = 'SocketUnreachable';
  }
}

/** A wire error from a body the server sent, or `unavailable` when the body is not one. */
const wireErrorOf = (body: unknown): WireError => {
  const parsed = wireErrorSchema.safeParse(body);
  return parsed.success ? parsed.data : { code: 'unavailable' };
};

/**
 * The socket adapter of the Supervisor CLI (STRUCTURE §3): the shared route table, carried over
 * `factory.sock` to a running `factory-server`. A request is validated before it is sent and the
 * answer is validated when it arrives. A refusal throws `WireFailure`. A network failure is retried
 * with the same body, so the same commandId; after the last try it throws `WireFailure` with
 * `unavailable`, which the transport reads as "no server answered".
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
        if (last) throw new SocketUnreachable(options.socketPath);
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
