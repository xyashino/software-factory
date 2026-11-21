import { Unreachable } from '../../application/core/errors';
import type { CellServerPort } from '../../application/ports/cell-server.port';
import { mapReply } from './map-reply';

const REQUEST_TIMEOUT_MS = 10_000;

export interface CellServerClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

const JSON_HEADERS = { 'content-type': 'application/json' };

export const createCellServerAdapter = ({
  baseUrl,
  fetchImpl = fetch,
}: CellServerClientOptions): CellServerPort => {
  const send = async (route: string, init: RequestInit): Promise<unknown> => {
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${route}`, {
        ...init,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new Unreachable(`cannot reach cell server at ${baseUrl}`);
    }
    let text: string;
    try {
      text = await response.text();
    } catch {
      throw new Unreachable('cell server reply could not be read');
    }
    return mapReply(response.status, text);
  };

  return {
    health: () => send('/api/v1/health', { method: 'GET' }),
    get: (route) => send(route, { method: 'GET' }),
    post: (route, body) =>
      send(route, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(body ?? {}),
      }),
    patch: (route, body) =>
      send(route, {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify(body),
      }),
    delete: (route) => send(route, { method: 'DELETE' }),
  };
};
