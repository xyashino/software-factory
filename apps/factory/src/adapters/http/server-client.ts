import { Unreachable } from '../../application/core/errors';
import type { ServerPort } from '../../application/ports/server.port';
import { mapReply } from './map-reply';
import { readSseFrames } from './sse-client';

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

const searchOf = (query: Record<string, string>): string => {
  const search = new URLSearchParams(query).toString();
  return search.length > 0 ? `?${search}` : '';
};

const waitMsOf = (body: unknown): number => {
  const waitMs = (body as { waitMs?: unknown } | null)?.waitMs;
  return typeof waitMs === 'number' && waitMs > 0 ? waitMs : 0;
};

export const createServerClient = ({
  baseUrl,
  fetchImpl = fetch,
}: ServerClientOptions): ServerPort => {
  const send = async (
    url: string,
    init: RequestInit,
    timeoutMs: number = REQUEST_TIMEOUT_MS,
  ): Promise<Response> => {
    try {
      return await fetchImpl(url, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new Unreachable(`cannot reach factory server at ${baseUrl}`);
    }
  };

  return {
    call: async (route, body, token) => {
      // A claim long-polls for `waitMs` before the server answers, so its timeout must cover that wait.
      const waitMs = waitMsOf(body);
      const response = await send(
        `${baseUrl}${route}`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
        },
        REQUEST_TIMEOUT_MS + waitMs,
      );
      return mapReply(response.status, await readBody(response));
    },
    get: async (route, query, token) => {
      const response = await send(`${baseUrl}${route}${searchOf(query)}`, {
        method: 'GET',
        headers: { authorization: `Bearer ${token}` },
      });
      return mapReply(response.status, await readBody(response));
    },
    remove: async (route, token) => {
      const response = await send(`${baseUrl}${route}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${token}` },
      });
      return mapReply(response.status, await readBody(response));
    },
    stream: async function* (route, query, token, signal) {
      let response: Response;
      try {
        response = await fetchImpl(`${baseUrl}${route}${searchOf(query)}`, {
          method: 'GET',
          headers: {
            authorization: `Bearer ${token}`,
            accept: 'text/event-stream',
          },
          signal,
        });
      } catch {
        if (signal.aborted) {
          return;
        }
        throw new Unreachable(`cannot reach factory server at ${baseUrl}`);
      }
      if (!response.ok) {
        mapReply(response.status, await readBody(response));
      }
      if (response.body === null) {
        throw new Unreachable('server stream has no body');
      }
      try {
        yield* readSseFrames(response.body);
      } catch {
        if (signal.aborted) {
          return;
        }
        throw new Unreachable(`stream from ${baseUrl} dropped`);
      }
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
