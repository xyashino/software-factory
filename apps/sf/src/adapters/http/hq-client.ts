import { z } from 'zod';
import type {
  HqClientPort,
  HqReply,
} from '../../application/ports/hq-client.port';

const REQUEST_TIMEOUT_MS = 5_000;
const UNAUTHORIZED = 401;
const ENROLL_ROUTE = '/api/v1/factories/enroll';
const HEARTBEAT_ROUTE = '/api/v1/factories/heartbeat';

const EnrollReplySchema = z.object({
  factoryId: z.string().min(1),
  sessionToken: z.string().min(1),
  expiresAt: z.number().int(),
});

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

export const createHqClient = (
  fetchImpl: typeof fetch = fetch,
): HqClientPort => ({
  enroll: async ({ url, joinToken, name }) =>
    replyOf(
      await send(fetchImpl, `${url}${ENROLL_ROUTE}`, joinToken, { name }),
      EnrollReplySchema,
    ),
  heartbeat: async ({ url, sessionToken }) =>
    replyOf(
      await send(
        fetchImpl,
        `${url}${HEARTBEAT_ROUTE}`,
        sessionToken,
        undefined,
      ),
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
});
