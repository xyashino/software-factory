import { randomBytes, timingSafeEqual } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  operatorRequestSchema,
  type OperatorReply,
  type OperatorRequest,
} from '@repo/factory-core/contracts/operator';

/** The largest request body the Operator endpoint reads; a bigger one is refused, not buffered. */
export const MAX_BODY_BYTES = 1024 * 1024;

/** The per-Cycle token: 24 random bytes, hex. Never written to a log or a blob. */
export const newCycleToken = (): string => randomBytes(24).toString('hex');

type Refusal = Extract<OperatorReply, { ok: false }>;

/** HTTP status of each refusal code. A dispatched refusal is a state conflict, not a server fault. */
const STATUS: Record<Refusal['code'], number> = {
  unauthorized: 401,
  invalid: 400,
  rejected: 409,
  stale_epoch: 409,
  not_live: 409,
  precondition: 409,
  internal: 500,
};

export interface OperatorServerOptions {
  token: string;
  /** Answers one verb. Every reply is produced here, once the request has passed the checks. */
  dispatch: (request: OperatorRequest) => Promise<OperatorReply>;
}

export interface OperatorServer {
  /** `http://127.0.0.1:<port>`: the value of `FACTORY_OPERATOR_URL`. */
  readonly url: string;
  /** Closes the listener and every open connection. Idempotent. */
  close(): Promise<void>;
}

/** Compares two tokens without leaking the position of a mismatch. */
const tokenMatches = (given: unknown, expected: string): boolean => {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

const bearerOf = (authorization: string | undefined): string | undefined =>
  authorization?.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined;

const refuse = (
  code: Refusal['code'],
  message: string,
): Extract<OperatorReply, { ok: false }> => ({ ok: false, code, message });

/**
 * Checks one request: the token first (constant time), then the verb schema. The token comes from
 * the `Authorization: Bearer` header, or else from the body's `token` field. Returns the refusal to
 * send, or the parsed request.
 */
export const readRequest = (
  text: string,
  authorization: string | undefined,
  token: string,
): { ok: true; request: OperatorRequest } | { ok: false; reply: Refusal } => {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return { ok: false, reply: refuse('invalid', 'request is not JSON') };
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return {
      ok: false,
      reply: refuse('invalid', 'request must be a JSON object'),
    };
  }
  const bodyToken =
    'token' in body ? (body as { token: unknown }).token : undefined;
  const given = bearerOf(authorization) ?? bodyToken;
  if (!tokenMatches(given, token)) {
    return {
      ok: false,
      reply: refuse('unauthorized', 'the Cycle token is missing or wrong'),
    };
  }
  const parsed = operatorRequestSchema.safeParse({ ...body, token: given });
  if (!parsed.success) {
    return {
      ok: false,
      reply: refuse(
        'invalid',
        parsed.error.issues
          .map(
            (issue) => `${issue.path.join('.') || 'request'}: ${issue.message}`,
          )
          .join('; '),
      ),
    };
  }
  return { ok: true, request: parsed.data };
};

type Body =
  { kind: 'ok'; text: string } | { kind: 'too_large' } | { kind: 'error' };

const readBody = (req: IncomingMessage): Promise<Body> =>
  new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const settle = (body: Body): void => {
      if (settled) return;
      settled = true;
      resolve(body);
    };
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        chunks.length = 0;
        settle({ kind: 'too_large' });
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () =>
      settle({ kind: 'ok', text: Buffer.concat(chunks).toString('utf8') }),
    );
    req.on('error', () => settle({ kind: 'error' }));
  });

const send = (
  res: ServerResponse,
  status: number,
  body: OperatorReply,
  headers: Record<string, string> = {},
): void => {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
};

/** One request in, one reply out: the checks, then the dispatcher. */
const answer = async (
  req: IncomingMessage,
  res: ServerResponse,
  options: OperatorServerOptions,
): Promise<void> => {
  if (req.method !== 'POST') {
    send(res, 405, refuse('invalid', 'the Operator endpoint takes POST only'), {
      allow: 'POST',
    });
    return;
  }
  const body = await readBody(req);
  if (body.kind === 'too_large') {
    send(
      res,
      413,
      refuse('invalid', `request is larger than ${MAX_BODY_BYTES} bytes`),
    );
    return;
  }
  if (body.kind === 'error') {
    send(res, 400, refuse('invalid', 'request could not be read'));
    return;
  }
  const checked = readRequest(
    body.text,
    req.headers.authorization,
    options.token,
  );
  if (!checked.ok) {
    send(res, STATUS[checked.reply.code], checked.reply);
    return;
  }
  try {
    const reply = await options.dispatch(checked.request);
    send(res, reply.ok ? 200 : STATUS[reply.code], reply);
  } catch (error: unknown) {
    send(
      res,
      500,
      refuse(
        'internal',
        error instanceof Error ? error.message : String(error),
      ),
    );
  }
};

/**
 * Serves the Operator verbs of one Cycle on `127.0.0.1` at an OS-assigned port. One `POST` per
 * request, JSON in, JSON out. Only loopback is bound, so no other host reaches it; the Cycle token
 * is the gate (PROTOCOL §3.3).
 */
export const startOperatorServer = (
  options: OperatorServerOptions,
): Promise<OperatorServer> => {
  const server = createServer((req, res) => {
    answer(req, res, options).catch(() => res.destroy());
  });
  return new Promise<OperatorServer>((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    server.once('error', onError);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', onError);
      const { port } = server.address() as AddressInfo;
      let closing: Promise<void> | undefined;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => {
          closing ??= new Promise<void>((done) => {
            server.closeAllConnections();
            server.close(() => done());
          });
          return closing;
        },
      });
    });
  });
};
