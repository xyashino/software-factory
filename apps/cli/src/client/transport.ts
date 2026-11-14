import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { FactoryClient } from '@repo/factory-core/contracts/client';
import { WireFailure } from '@repo/factory-core/contracts/errors';
import {
  ROUTES,
  type RouteName,
  type RouteRequest,
  type RouteResponse,
} from '@repo/factory-core/contracts/routes';
import { runOnce } from './once';
import { SocketUnreachable, socketFactoryClient } from './socket';

/** The socket inside the data directory (PROTOCOL §2). */
export const SOCKET_FILE_NAME = 'factory.sock';

/** How long a one-shot waits for a server that is starting to bring its socket up. */
const STARTUP_TRIES = 15;
const STARTUP_PAUSE_MS = 200;

export interface TransportOptions {
  dataDir: string;
  /** The `factory-server` entry point, run with `--once` when no server answers. */
  serverBin: string;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The FactoryClient of the Supervisor CLI (PROTOCOL §2, §10). When `factory.sock` exists and answers,
 * every call goes over the socket to the running server. Otherwise the call is one `--once` run: a
 * subprocess that takes the writer lock, runs the route and exits. Reads and writes both work
 * without a server. A refusal throws `WireFailure` with its wire error; a call nothing answers throws
 * `unavailable`.
 *
 * A held writer lock with no socket means a server is starting up, so the one-shot waits and tries
 * again for a few seconds before it gives up.
 */
export const factoryClientFor = (options: TransportOptions): FactoryClient => {
  const socketPath = join(options.dataDir, SOCKET_FILE_NAME);
  const socket = socketFactoryClient({
    socketPath,
    attempts: 2,
    retryDelayMs: 50,
  });

  const call = async <K extends RouteName>(
    route: K,
    request: RouteRequest<K>,
  ): Promise<RouteResponse<K>> => {
    const parsed = ROUTES[route].request.parse(request);
    for (let attempt = 1; ; attempt += 1) {
      if (existsSync(socketPath)) {
        try {
          return await socket.call(route, request);
        } catch (error) {
          // A server that answered with an error has said what happened: report it, do not retry it
          // as a one-shot. Only an unreachable socket falls through.
          if (!(error instanceof SocketUnreachable)) throw error;
        }
      }
      const result = await runOnce(
        { serverBin: options.serverBin, dataDir: options.dataDir },
        route,
        parsed,
      );
      if (result.kind === 'ok') return result.response as RouteResponse<K>;
      if (result.kind === 'refused') throw new WireFailure(result.error);
      if (result.kind === 'failed') {
        throw new WireFailure({ code: 'unavailable' }, 503);
      }
      if (attempt >= STARTUP_TRIES) {
        throw new WireFailure({ code: 'unavailable' }, 503);
      }
      await sleep(STARTUP_PAUSE_MS);
    }
  };

  return { call };
};
