import { Unreachable } from '../../application/core/errors';
import type { FactoryPort } from '../../application/ports/factory.port';
import { mapReply } from './map-reply';

const REQUEST_TIMEOUT_MS = 10_000;
const NOT_RUNNING = 'factory not running: run "sf factory start"';

export interface FactoryClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

const JSON_HEADERS = { 'content-type': 'application/json' };

export const createFactoryAdapter = ({
  baseUrl,
  fetchImpl = fetch,
}: FactoryClientOptions): FactoryPort => {
  const send = async (route: string, init: RequestInit): Promise<unknown> => {
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${route}`, {
        ...init,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new Unreachable(NOT_RUNNING);
    }
    let text: string;
    try {
      text = await response.text();
    } catch {
      throw new Unreachable('factory reply could not be read');
    }
    return mapReply(response.status, text);
  };

  return {
    get: (route) => send(route, { method: 'GET' }),
    post: (route, body) =>
      send(route, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(body),
      }),
    put: (route, body) =>
      send(route, {
        method: 'PUT',
        headers: JSON_HEADERS,
        body: JSON.stringify(body),
      }),
  };
};
