import { randomBytes } from 'node:crypto';
import { enrollCellContract } from '@repo/factory-contracts/cells.contract';
import { z } from 'zod';
import type { FactoryCredential } from '../domain/factory/factory-credential';

export const RELAY_PATH = '/relay';

const REQUEST_TIMEOUT_MS = 10_000;
const ENROLL_ROUTE = '/api/v1/cells/enroll';
const UNAUTHORIZED = 401;
const BEARER = 'Bearer ';
const JSON_HEADERS = { 'content-type': 'application/json' };
const ALLOWED_ROUTES = [
  /^\/api\/v1\/cells\/(enroll|hello|claims|heartbeats|leave)$/,
  /^\/api\/v1\/jobs\/[^/]+\/transitions$/,
  /^\/api\/v1\/incidents\/[^/]+\/resolve$/,
];
const EnrollBodySchema = enrollCellContract.in.body;
const EnrollReplySchema = z.object({
  cellId: z.string(),
  sessionToken: z.string(),
  expiresAt: z.number().int(),
});
const WaitSchema = z.object({ waitMs: z.number().min(0).optional() });

type EnrollBody = z.infer<typeof EnrollBodySchema>;
type EnrollReply = z.infer<typeof EnrollReplySchema>;

interface HqSession {
  sessionToken: string;
  enroll: EnrollBody;
}

interface Grant {
  cellId: string;
  name: string;
  hq: HqSession | null;
}

interface Live {
  token: string;
  grant: Grant;
}

type Enrolled =
  { kind: 'ok'; reply: EnrollReply } | { kind: 'failed'; response: Response };

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

const randomName = (): string => `cell-${randomBytes(4).toString('hex')}`;

const streamed = (reply: Response): Response =>
  new Response(reply.body, { status: reply.status, headers: JSON_HEADERS });

const send = async (
  url: string,
  token: string,
  path: string,
  body: string,
  timeoutMs: number,
): Promise<Response | null> => {
  try {
    return await fetch(`${url}${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body,
      signal: AbortSignal.timeout(timeoutMs),
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

  const enrollHq = async (
    live: Live,
    credential: FactoryCredential,
    enroll: EnrollBody,
  ): Promise<Enrolled> => {
    const reply = await send(
      credential.url,
      credential.sessionToken,
      ENROLL_ROUTE,
      JSON.stringify({ ...enroll, name: live.grant.name }),
      REQUEST_TIMEOUT_MS,
    );
    if (reply === null) {
      return { kind: 'failed', response: unavailable() };
    }
    if (reply.status === UNAUTHORIZED) {
      await stop(live);
      return {
        kind: 'failed',
        response: failure(
          UNAUTHORIZED,
          'unauthorized',
          'factory credential rejected, cell stopped',
        ),
      };
    }
    const text = await reply.text();
    if (!reply.ok) {
      return {
        kind: 'failed',
        response: new Response(text, {
          status: reply.status,
          headers: JSON_HEADERS,
        }),
      };
    }
    const parsed = EnrollReplySchema.safeParse(parseJson(text));
    if (!parsed.success) {
      return { kind: 'failed', response: unavailable() };
    }
    live.grant.hq = { sessionToken: parsed.data.sessionToken, enroll };
    return { kind: 'ok', reply: parsed.data };
  };

  const enroll = async (
    live: Live,
    credential: FactoryCredential,
    text: string,
  ): Promise<Response> => {
    const parsed = EnrollBodySchema.safeParse(parseJson(text));
    if (!parsed.success) {
      return failure(400, 'argument', parsed.error.message);
    }
    const enrolled = await enrollHq(live, credential, parsed.data);
    if (enrolled.kind === 'failed') {
      return enrolled.response;
    }
    return Response.json(
      {
        code: 201,
        cellId: enrolled.reply.cellId,
        sessionToken: live.token,
        expiresAt: enrolled.reply.expiresAt,
      },
      { status: 201 },
    );
  };

  const forward = async (
    live: Live,
    credential: FactoryCredential,
    path: string,
    text: string,
  ): Promise<Response> => {
    const hq = live.grant.hq;
    if (hq === null) {
      return failure(UNAUTHORIZED, 'unauthorized', 'cell is not enrolled');
    }
    const timeoutMs = REQUEST_TIMEOUT_MS + waitMsOf(text);
    const first = await send(
      credential.url,
      hq.sessionToken,
      path,
      text,
      timeoutMs,
    );
    if (first === null) {
      return unavailable();
    }
    if (first.status !== UNAUTHORIZED) {
      return streamed(first);
    }
    await first.body?.cancel();
    const renewed = await enrollHq(live, credential, hq.enroll);
    if (renewed.kind === 'failed') {
      return renewed.response;
    }
    const second = await send(
      credential.url,
      renewed.reply.sessionToken,
      path,
      text,
      timeoutMs,
    );
    if (second === null) {
      return unavailable();
    }
    if (second.status !== UNAUTHORIZED) {
      return streamed(second);
    }
    await stop(live);
    return failure(
      UNAUTHORIZED,
      'unauthorized',
      'cell session rejected twice, cell stopped',
    );
  };

  return {
    issue: (cellId) => {
      for (const [token, grant] of grants) {
        if (!deps.alive(grant.cellId)) {
          grants.delete(token);
        }
      }
      const token = randomBytes(32).toString('hex');
      grants.set(token, { cellId, name: randomName(), hq: null });
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
      if (path === ENROLL_ROUTE) {
        return enroll(live, credential, text);
      }
      return forward(live, credential, path, text);
    },
  };
};
