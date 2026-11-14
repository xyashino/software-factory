import type { RouteName, RouteRequest, RouteResponse } from './routes';

/**
 * The one client interface the CLI, a Worker and the tests use (PROTOCOL §2). The socket client
 * implements it over `factory.sock`; a direct runtime adapter implements it locally. Both answer
 * the same routes with the same payloads, so tests can compare them.
 */
export interface FactoryClient {
  call<K extends RouteName>(
    route: K,
    request: RouteRequest<K>,
  ): Promise<RouteResponse<K>>;
}
