import type { FactoryClient } from '@repo/factory-core/contracts/client';
import {
  joinResponseSchema,
  type JoinResponse,
} from '@repo/factory-core/contracts/cell';
import { WireFailure } from '@repo/factory-core/contracts/errors';
import {
  decodeHttpAnswer,
  encodeHttpCall,
  refusalOf,
} from '@repo/factory-core/contracts/http-codec';
import {
  ROUTES,
  type RouteName,
  type RouteRequest,
  type RouteResponse,
} from '@repo/factory-core/contracts/routes';

/**
 * The Cell's client in remote mode (PROTOCOL §2, §3.2): the Cell's routes over TCP HTTP, with the Cell
 * credential as the bearer. Encoding and decoding are the shared codec's; this file adds the transport:
 * the fetch, and the retries of PROTOCOL §3.5 (a network failure or a 5xx is retried with the same body,
 * so the same commandId, until the attempts run out). A 401 is final here: the caller decides to join again.
 */

export interface RemoteCellOptions {
  /** The Factory's address, e.g. `http://factory.example:7878`. */
  baseUrl: string;
  /** The Cell credential, from the join. Never logged. */
  credential: string;
  /** Tries per call for network failures and 5xx answers. */
  attempts?: number;
  /** First pause between tries; it doubles each try. */
  baseDelayMs?: number;
  /** Replaces `fetch`, so tests can script the answers. */
  fetchImpl?: typeof fetch;
  /** Replaces the pause, so tests do not wait. */
  sleep?: (ms: number) => Promise<void>;
}

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** The Cell's routes only: a supervisor route is not for a Cell, so it is refused before any call. */
const CELL_ROUTES: ReadonlySet<string> = new Set([
  'hello',
  'claim',
  'heartbeat',
  'submitCommand',
  'blobPut',
  'blobGet',
]);

const unavailable = (): WireFailure => new WireFailure({ code: 'unavailable' });

/**
 * True when the Factory refused the Cell's credential (401): the Cell was revoked, or its credential
 * was never issued. The loops report it, and the Cell stops its jobs and joins again (PROTOCOL §1).
 */
export const isUnauthorized = (error: unknown): boolean =>
  error instanceof WireFailure && error.error.code === 'unauthorized';

/** One HTTP exchange: the answer's status and bytes, or undefined when nothing answered. */
const exchange = async (
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<{ status: number; bytes: Uint8Array } | undefined> => {
  try {
    const response = await fetchImpl(url, init);
    return {
      status: response.status,
      bytes: new Uint8Array(await response.arrayBuffer()),
    };
  } catch {
    return undefined;
  }
};

/**
 * Builds the Cell's FactoryClient over HTTP. A call that the Factory refuses throws its `WireFailure`
 * at once; an answer that is lost or a 5xx is retried with the same request until `attempts` run out,
 * then throws `unavailable`.
 */
export const remoteFactoryClient = (
  options: RemoteCellOptions,
): FactoryClient => {
  const fetchImpl = options.fetchImpl ?? fetch;
  const pause = options.sleep ?? wait;
  const attempts = options.attempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 200;
  const authorization = `Bearer ${options.credential}`;

  const call = async <K extends RouteName>(
    route: K,
    request: RouteRequest<K>,
  ): Promise<RouteResponse<K>> => {
    if (!CELL_ROUTES.has(route)) {
      throw new Error(`${route} is not a Cell route`);
    }
    const parsed = ROUTES[route].request.parse(request) as RouteRequest<K>;
    const encoded = encodeHttpCall(route, parsed);
    const headers: Record<string, string> = { authorization };
    let body: BodyInit | undefined;
    if (encoded.raw !== undefined) {
      headers['content-type'] = encoded.mediaType ?? 'application/octet-stream';
      body = encoded.raw as BodyInit;
    } else if (encoded.json !== undefined) {
      headers['content-type'] = 'application/json';
      body = encoded.json;
    }
    const url = `${options.baseUrl}${encoded.path}`;

    for (let attempt = 1; ; attempt += 1) {
      const answer = await exchange(fetchImpl, url, {
        method: encoded.method,
        headers,
        body,
      });
      if (answer && answer.status < 500) {
        const decoded = decodeHttpAnswer(
          route,
          parsed,
          answer.status,
          answer.bytes,
        );
        return ROUTES[route].response.parse(decoded) as RouteResponse<K>;
      }
      if (answer && answer.status >= 500 && attempt >= attempts) {
        throw refusalOf(answer.status, answer.bytes);
      }
      if (attempt >= attempts) throw unavailable();
      await pause(baseDelayMs * 2 ** (attempt - 1));
    }
  };

  return { call };
};

/**
 * Enrolls this Cell with a join token (PROTOCOL §3.2, §1). The Factory names the Cell and returns its
 * credential once; the caller keeps both. A refused token is a `WireFailure` with status 401.
 */
export const joinRemote = async (options: {
  baseUrl: string;
  joinToken: string;
  name: string;
  fetchImpl?: typeof fetch;
}): Promise<JoinResponse> => {
  const fetchImpl = options.fetchImpl ?? fetch;
  const answer = await exchange(fetchImpl, `${options.baseUrl}/v1/cell/join`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ joinToken: options.joinToken, name: options.name }),
  });
  if (!answer) throw unavailable();
  if (answer.status >= 400) throw refusalOf(answer.status, answer.bytes);
  return joinResponseSchema.parse(
    JSON.parse(new TextDecoder().decode(answer.bytes)),
  );
};
