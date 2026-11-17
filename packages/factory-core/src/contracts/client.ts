import type { StoredEvent } from '../order/events';
import type { RouteName, RouteRequest, RouteResponse } from './routes';

/**
 * The one client interface the CLI, a Cell and the tests use. The HTTP client
 * implements it over HTTP; a direct runtime adapter implements it locally. Both answer
 * the same routes with the same payloads, so tests can compare them.
 */
export interface FactoryClient {
  call<K extends RouteName>(
    route: K,
    request: RouteRequest<K>,
  ): Promise<RouteResponse<K>>;
}

/**
 * Event subscription: every stored event after `afterGlobalSeq`, in global order,
 * until the signal aborts. Kept apart from `FactoryClient` so the request/response contract is
 * unchanged; the HTTP client implements both.
 */
export interface FactoryFeed {
  stream(
    afterGlobalSeq: number,
    signal?: AbortSignal,
  ): AsyncIterable<StoredEvent>;
}
