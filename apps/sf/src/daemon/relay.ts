import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { FactoryCredential } from '../domain/factory/factory-credential';

export const RELAY_PATH = '/relay';

const REQUEST_TIMEOUT_MS = 10_000;
const UNAUTHORIZED = 401;
const BEARER = 'Bearer ';
const CELL_HEADER = 'x-cell-id';
const JSON_HEADERS = { 'content-type': 'application/json' };
const ALLOWED_ROUTES = [
  /^\/api\/v1\/cells\/(claims|heartbeats|leave)$/,
  /^\/api\/v1\/jobs\/[^/]+\/transitions$/,
  /^\/api\/v1\/incidents\/[^/]+\/resolve$/,
];
const WaitSchema = z.object({ waitMs: z.number().min(0).optional() });

interface Grant {
  cellId: string;
}

interface Live {
  token: string;
  grant: Grant;
}

export interface RelayDeps {
  credential: () => FactoryCredential | null;
  alive: (cellId: string) => boolean;
  kill: (cellId: string) => Promise<boolean>;
}

export interface Relay {
  issue(cellId: string): string;
  handle(request: Request): Promise<Response>;
}

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

const failure = (status: number, type: string, message: string): Response =>
  Response.json({ code: status, type, message }, { status });

const unavailable = (): Response =>
  failure(503, 'unreachable', 'HQ unreachable');

const bearerOf = (request: Request): string | null => {
  const header = request.headers.get('authorization');
  return header?.startsWith(BEARER) ? header.slice(BEARER.length) : null;
};

const waitMsOf = (text: string): number => {
  const parsed = WaitSchema.safeParse(parseJson(text));
  return parsed.success ? (parsed.data.waitMs ?? 0) : 0;
};

const isAllowed = (request: Request, path: string): boolean =>
  request.method === 'POST' &&
  ALLOWED_ROUTES.some((pattern) => pattern.test(path));

const streamed = (reply: Response): Response =>
  new Response(reply.body, { status: reply.status, headers: JSON_HEADERS });

const send = async (
  credential: FactoryCredential,
  path: string,
  body: string,
  cellId: string,
): Promise<Response | null> => {
  try {
    return await fetch(`${credential.url}${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${credential.sessionToken}`,
        [CELL_HEADER]: cellId,
        'content-type': 'application/json',
      },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS + waitMsOf(body)),
    });
  } catch {
    return null;
  }
};

export const createRelay = (deps: RelayDeps): Relay => {
  const grants = new Map<string, Grant>();

  const liveOf = (request: Request): Live | null => {
    const token = bearerOf(request);
    const grant = token === null ? undefined : grants.get(token);
    if (token === null || grant === undefined) {
      return null;
    }
    if (deps.alive(grant.cellId)) {
      return { token, grant };
    }
    grants.delete(token);
    return null;
  };

  const stop = async (live: Live): Promise<void> => {
    await deps.kill(live.grant.cellId);
    grants.delete(live.token);
  };

  return {
    issue: (cellId) => {
      for (const [token, grant] of grants) {
        if (!deps.alive(grant.cellId)) {
          grants.delete(token);
        }
      }
      const token = randomBytes(32).toString('hex');
      grants.set(token, { cellId });
      return token;
    },
    handle: async (request) => {
      const url = new URL(request.url);
      const path = url.pathname.slice(RELAY_PATH.length);
      if (!isAllowed(request, path)) {
        return failure(
          403,
          'forbidden',
          `route ${request.method} ${path} is not relayed`,
        );
      }
      const live = liveOf(request);
      if (live === null) {
        return failure(
          UNAUTHORIZED,
          'unauthorized',
          'unknown or expired cell token',
        );
      }
      const credential = deps.credential();
      if (credential === null) {
        return failure(
          503,
          'unreachable',
          'factory not connected: run "sf factory connect"',
        );
      }
      const text = await request.text();
      const reply = await send(credential, path, text, live.grant.cellId);
      if (reply === null) {
        return unavailable();
      }
      if (reply.status === UNAUTHORIZED) {
        await reply.body?.cancel();
        await stop(live);
        return failure(
          UNAUTHORIZED,
          'unauthorized',
          'factory credential rejected, cell stopped',
        );
      }
      return streamed(reply);
    },
  };
};
