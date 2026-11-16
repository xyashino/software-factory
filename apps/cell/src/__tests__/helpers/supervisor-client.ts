import type { FactoryClient } from '@repo/factory-core/contracts/client';
import {
  decodeHttpAnswer,
  encodeHttpCall,
} from '@repo/factory-core/contracts/http-codec';
import {
  ROUTES,
  type RouteName,
  type RouteRequest,
  type RouteResponse,
} from '@repo/factory-core/contracts/routes';

/**
 * The supervisor side of a test server: every route the supervisor may call, over HTTP with the bearer
 * token (PROTOCOL §3.0). The Cell's own routes go through `remoteFactoryClient`; this client is for the rest.
 */
export const supervisorClient = (
  baseUrl: string,
  token: string,
): FactoryClient => ({
  call: async <K extends RouteName>(
    route: K,
    request: RouteRequest<K>,
  ): Promise<RouteResponse<K>> => {
    const parsed = ROUTES[route].request.parse(request) as RouteRequest<K>;
    const encoded = encodeHttpCall(route, parsed);
    const headers: Record<string, string> = {
      authorization: `Bearer ${token}`,
    };
    let body: BodyInit | undefined;
    if (encoded.raw !== undefined) {
      headers['content-type'] = encoded.mediaType ?? 'application/octet-stream';
      body = encoded.raw as BodyInit;
    } else if (encoded.json !== undefined) {
      headers['content-type'] = 'application/json';
      body = encoded.json;
    }
    const response = await fetch(`${baseUrl}${encoded.path}`, {
      method: encoded.method,
      headers,
      body,
    });
    const bytes = new Uint8Array(await response.arrayBuffer());
    const answer = decodeHttpAnswer(route, parsed, response.status, bytes);
    return ROUTES[route].response.parse(answer) as RouteResponse<K>;
  },
});
