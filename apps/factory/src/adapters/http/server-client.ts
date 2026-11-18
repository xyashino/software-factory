import { Unreachable } from '../../application/core/errors';
import type { ServerPort } from '../../application/ports/server.port';
import { mapReply } from './map-reply';

const REQUEST_TIMEOUT_MS = 10_000;
const PROBE_TIMEOUT_MS = 1_000;

export interface ServerClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

const readBody = async (response: Response): Promise<string> => {
  try {
    return await response.text();
  } catch {
    throw new Unreachable('server reply could not be read');
  }
};

export const createServerClient = ({
  baseUrl,
  fetchImpl = fetch,
}: ServerClientOptions): ServerPort => {
  const send = async (url: string, init: RequestInit): Promise<Response> => {
    try {
      return await fetchImpl(url, {
        ...init,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new Unreachable(`cannot reach factory server at ${baseUrl}`);
    }
  };

  return {
    call: async (route, body, token) => {
      const response = await send(`${baseUrl}${route}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      return mapReply(response.status, await readBody(response));
    },
    get: async (route, query, token) => {
      const search = new URLSearchParams(query).toString();
      const response = await send(
        `${baseUrl}${route}${search.length > 0 ? `?${search}` : ''}`,
        {
          method: 'GET',
          headers: { authorization: `Bearer ${token}` },
        },
      );
      return mapReply(response.status, await readBody(response));
    },
    stream: () => {
      throw new Error('stream is not wired in this step');
    },
    probe: async () => {
      try {
        const response = await fetchImpl(baseUrl, {
          method: 'GET',
          signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        });
        await response.body?.cancel();
        return true;
      } catch {
        return false;
      }
    },
  };
};
