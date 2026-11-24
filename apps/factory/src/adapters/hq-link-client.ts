import { z } from 'zod';
import { queueReplyOf } from '../queue-reply';
import type { HqLinkPort, HqReply } from '../ports';

const REQUEST_TIMEOUT_MS = 5_000;
const UNAUTHORIZED = 401;
const HEARTBEAT_ROUTE = '/api/v1/factories/heartbeat';
const QUEUE_IMPORT_ROUTE = '/api/v1/queue/import';

const HeartbeatReplySchema = z.object({ factoryId: z.string().min(1) });
const GoneReplySchema = z.object({ cellId: z.string().min(1) });

interface Parser<T> {
  parse(raw: unknown): T;
}

const goneRouteOf = (cellId: string): string =>
  `/api/v1/factories/cells/${encodeURIComponent(cellId)}/gone`;

const send = async (
  fetchImpl: typeof fetch,
  url: string,
  token: string,
  body: unknown,
): Promise<Response | null> => {
  try {
    return await fetchImpl(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return null;
  }
};

const replyOf = async <T>(
  response: Response | null,
  schema: Parser<T>,
): Promise<HqReply<T>> => {
  if (response === null) return { kind: 'unreachable' };
  if (response.status === UNAUTHORIZED) return { kind: 'rejected' };
  if (!response.ok) return { kind: 'unreachable' };
  try {
    return { kind: 'ok', value: schema.parse(await response.json()) };
  } catch {
    return { kind: 'unreachable' };
  }
};

export const createHqLinkClient = (
  fetchImpl: typeof fetch = fetch,
): HqLinkPort => ({
  heartbeat: async ({ url, sessionToken, projects }) =>
    replyOf(
      await send(fetchImpl, `${url}${HEARTBEAT_ROUTE}`, sessionToken, {
        projects,
      }),
      HeartbeatReplySchema,
    ),
  goneCell: async ({ url, sessionToken, cellId }) =>
    replyOf(
      await send(
        fetchImpl,
        `${url}${goneRouteOf(cellId)}`,
        sessionToken,
        undefined,
      ),
      GoneReplySchema,
    ),
  importQueue: async ({ url, bearer, body }) => {
    const response = await send(
      fetchImpl,
      `${url}${QUEUE_IMPORT_ROUTE}`,
      bearer,
      body,
    );
    if (response === null) return { kind: 'unreachable' };
    if (response.status === UNAUTHORIZED) return { kind: 'unauthorized' };
    try {
      return await queueReplyOf(response);
    } catch {
      return { kind: 'unreachable' };
    }
  },
});
