import type { FactoryClient } from '@repo/factory-core/contracts/client';
import { WireFailure } from '@repo/factory-core/contracts/errors';
import {
  decodeHttpAnswer,
  encodeHttpCall,
  refusalOf,
} from '@repo/factory-core/contracts/http-codec';
import {
  ROUTES,
  type RouteName,
  type RouteRequest,
  type RouteResponse,
} from '@repo/factory-core/contracts/routes';
import type { StoredEvent } from '@repo/factory-core/order/events';

/**
 * No answer from the server at its address: nothing listens there, or the connection dropped. The
 * transport takes this as "no running server" and falls back to a one-shot run; a refusal never is.
 */
export class ServerUnreachable extends WireFailure {
  constructor() {
    super({ code: 'unavailable' });
    this.name = 'ServerUnreachable';
  }
}

/**
 * The FactoryClient of the Supervisor CLI (PROTOCOL §2, §3.0). Every call goes over HTTP to the
 * server's routes, encoded and decoded by the shared codec. Local and remote mode both use it: local
 * mode reads the server's address and local token from the discovery file. Refusals keep their wire
 * error (`WireFailure`).
 */
export interface RemoteClientOptions {
  /** The server's address, e.g. `http://factory.example:7878`. */
  baseUrl: string;
  /** A supervisor token (`FACTORY_TOKEN`). Sent as a bearer on every call; never logged. */
  token: string;
}

/** The longest a feed read holds when nothing is new; a little more than a claim long-poll. */
const FEED_HOLD_MS = 25_000;
/** A feed read with `waitMs: 0` still waits this long for events the server already holds. */
const MIN_FEED_HOLD_MS = 100;

/** Splits complete SSE blocks out of a buffer; the rest stays for the next chunk. */
const takeBlocks = (buffer: string): { blocks: string[]; rest: string } => {
  const blocks: string[] = [];
  let rest = buffer;
  for (let end = rest.indexOf('\n\n'); end !== -1; end = rest.indexOf('\n\n')) {
    blocks.push(rest.slice(0, end));
    rest = rest.slice(end + 2);
  }
  return { blocks, rest };
};

const eventOf = (block: string): StoredEvent | undefined => {
  const line = block.split('\n').find((text) => text.startsWith('data: '));
  return line
    ? (JSON.parse(line.slice('data: '.length)) as StoredEvent)
    : undefined;
};

/**
 * The event feed as the CLI reads it: the events after `afterGlobalSeq`, from `GET /v1/stream`. It
 * returns at once with what the stream has sent, or after `waitMs` with nothing. The long-poll answers
 * the same question with a long-poll; this is that answer over server-sent events.
 */
const eventsAfter = async (
  options: RemoteClientOptions,
  afterGlobalSeq: number,
  waitMs: number,
): Promise<{ events: StoredEvent[]; nextSeq: number }> => {
  const controller = new AbortController();
  const hold = setTimeout(
    () => controller.abort(),
    Math.max(waitMs, MIN_FEED_HOLD_MS),
  );
  const events: StoredEvent[] = [];
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    let response: Response;
    try {
      response = await fetch(
        `${options.baseUrl}/v1/stream?after=${afterGlobalSeq}`,
        {
          headers: { authorization: `Bearer ${options.token}` },
          signal: controller.signal,
        },
      );
    } catch {
      throw new ServerUnreachable();
    }
    if (!response.ok) {
      throw refusalOf(
        response.status,
        new Uint8Array(await response.arrayBuffer()),
      );
    }
    if (!response.body) throw new ServerUnreachable();
    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (events.length === 0) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const taken = takeBlocks(buffer);
      buffer = taken.rest;
      for (const block of taken.blocks) {
        const event = eventOf(block);
        if (event) events.push(event);
      }
    }
  } catch (error) {
    if (!controller.signal.aborted) throw error;
  } finally {
    clearTimeout(hold);
    controller.abort();
    await reader?.cancel().catch(() => undefined);
  }
  const last = events.at(-1);
  return { events, nextSeq: last ? last.globalSeq : afterGlobalSeq };
};

/**
 * Builds the FactoryClient for one server. A transport failure (no answer) throws `ServerUnreachable`,
 * which is a `WireFailure` with code `unavailable`, so a command's error reads the same whatever the cause.
 */
export const remoteFactoryClient = (
  options: RemoteClientOptions,
): FactoryClient => {
  const authorization = `Bearer ${options.token}`;

  const call = async <K extends RouteName>(
    route: K,
    request: RouteRequest<K>,
  ): Promise<RouteResponse<K>> => {
    if (route === 'supervisorEvents') {
      const feed = request as { afterGlobalSeq: number; waitMs?: number };
      const page = await eventsAfter(
        options,
        feed.afterGlobalSeq,
        Math.min(feed.waitMs ?? 0, FEED_HOLD_MS),
      );
      return ROUTES.supervisorEvents.response.parse(page) as RouteResponse<K>;
    }
    const parsed = ROUTES[route].request.parse(request) as RouteRequest<K>;
    const encoded = encodeHttpCall(route, parsed);
    const headers: Record<string, string> = { authorization };
    let body: BodyInit | undefined;
    if (encoded.raw !== undefined) {
      headers['content-type'] = encoded.mediaType ?? 'application/octet-stream';
      body = encoded.raw as BodyInit;
    } else if (encoded.json !== undefined) {
      headers['content-type'] = 'application/json';
      body = encoded.json;
    }
    let response: Response;
    try {
      response = await fetch(`${options.baseUrl}${encoded.path}`, {
        method: encoded.method,
        headers,
        body,
      });
    } catch {
      throw new ServerUnreachable();
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    const answer = decodeHttpAnswer(route, parsed, response.status, bytes);
    return ROUTES[route].response.parse(answer) as RouteResponse<K>;
  };

  return { call };
};
