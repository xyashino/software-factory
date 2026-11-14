import type { StoredEvent } from '../order/events';
import type { RouteName, RouteRequest, RouteResponse } from './routes';

/**
 * The one client interface the CLI, a Cell and the tests use (PROTOCOL §2). The socket client
 * implements it over `factory.sock`; a direct runtime adapter implements it locally. Both answer
 * the same routes with the same payloads, so tests can compare them.
 */
export interface FactoryClient {
  call<K extends RouteName>(
    route: K,
    request: RouteRequest<K>,
  ): Promise<RouteResponse<K>>;
}

/**
 * Event subscription (PROTOCOL §3.0): every stored event after `afterGlobalSeq`, in global order,
 * until the signal aborts. Kept apart from `FactoryClient` so the request/response contract is
 * unchanged; the socket client implements both.
 */
export interface FactoryFeed {
  stream(
    afterGlobalSeq: number,
    signal?: AbortSignal,
  ): AsyncIterable<StoredEvent>;
}
