import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FactoryClient } from '@repo/factory-core/contracts/client';
import { WireFailure } from '@repo/factory-core/contracts/errors';
import {
  DISCOVERY_FILE_NAME,
  parseDiscovery,
  type Discovery,
} from '@repo/factory-core/contracts/discovery';
import {
  ROUTES,
  type RouteName,
  type RouteRequest,
  type RouteResponse,
} from '@repo/factory-core/contracts/routes';
import { remoteFactoryClient, ServerUnreachable } from './remote';
import { runOnce } from './once';

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
 * The discovery file a running `factory-server` wrote into the data directory. Absent,
 * unreadable or damaged reads as undefined: no server is known, and the caller takes its fallback.
 */
export const readDiscovery = (dataDir: string): Discovery | undefined => {
  const path = join(dataDir, DISCOVERY_FILE_NAME);
  if (!existsSync(path)) return undefined;
  try {
    return parseDiscovery(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
};

/**
 * The FactoryClient of the Supervisor CLI in local mode. When the discovery file
 * names a server that answers, every call goes over HTTP to it, with the local token it carries, so no
 * `FACTORY_TOKEN` is needed. Otherwise the call is one `--once` run: a subprocess that takes the writer
 * lock, runs the route and exits. Reads and writes both work without a server. A refusal throws
 * `WireFailure` with its wire error; a call nothing answers throws `unavailable`.
 *
 * A held writer lock with no answering server means a server is starting up, so the one-shot waits and
 * tries again for a few seconds before it gives up.
 */
export const factoryClientFor = (options: TransportOptions): FactoryClient => {
  const call = async <K extends RouteName>(
    route: K,
    request: RouteRequest<K>,
  ): Promise<RouteResponse<K>> => {
    const parsed = ROUTES[route].request.parse(request);
    for (let attempt = 1; ; attempt += 1) {
      const discovery = readDiscovery(options.dataDir);
      if (discovery !== undefined) {
        const server = remoteFactoryClient({
          baseUrl: discovery.url,
          token: discovery.token,
        });
        try {
          return await server.call(route, request);
        } catch (error) {
          // A server that answered with an error has said what happened: report it, do not retry it
          // as a one-shot. Only an unreachable server falls through.
          if (!(error instanceof ServerUnreachable)) throw error;
        }
      }
      // With no server, a feed poll is answered at once: a one-shot holds the writer lock while it
      // waits, so a long-poll here would block a server starting up (`nextEvents` pauses between polls).
      const oneShot =
        route === 'supervisorEvents' ? { ...parsed, waitMs: 0 } : parsed;
      const result = await runOnce(
        { serverBin: options.serverBin, dataDir: options.dataDir },
        route,
        oneShot,
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
