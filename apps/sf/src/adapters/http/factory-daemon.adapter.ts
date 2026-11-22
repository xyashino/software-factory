import { Unreachable } from '../../application/core/errors';
import type { FactoryDaemonPort } from '../../application/ports/factory-daemon.port';
import { mapReply } from './map-reply';

const REQUEST_TIMEOUT_MS = 10_000;
const NOT_RUNNING = 'factory not running: run "sf factory start"';

export interface FactoryDaemonClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

const JSON_HEADERS = { 'content-type': 'application/json' };

export const createFactoryDaemonAdapter = ({
  baseUrl,
  fetchImpl = fetch,
}: FactoryDaemonClientOptions): FactoryDaemonPort => {
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
    delete: (route) => send(route, { method: 'DELETE' }),
  };
};
