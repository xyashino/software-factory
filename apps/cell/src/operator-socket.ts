import { randomBytes, timingSafeEqual } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import {
  operatorRequestSchema,
  type OperatorReply,
  type OperatorRequest,
} from '@repo/factory-core/contracts/operator';

/** The largest request body the Operator endpoint reads; a verb's text fields are capped far below. */
export const MAX_BODY_BYTES = 1024 * 1024;

/** The per-Cycle token: 24 random bytes, hex. Never written to a log or a blob. */
export const newCycleToken = (): string => randomBytes(24).toString('hex');

export interface OperatorServerOptions {
  token: string;
  /** Answers one verb. Every reply is produced here, once the request has passed the checks. */
  dispatch: (request: OperatorRequest) => Promise<OperatorReply>;
}

export interface OperatorServer {
  /** The base URL the Operator CLI posts to, e.g. `http://127.0.0.1:52817`. */
  readonly url: string;
  /** Stops the listener and drops open connections. Idempotent. */
  close(): Promise<void>;
}

type Refusal = Extract<OperatorReply, { ok: false }>;

/** The HTTP status of each reply code (PROTOCOL §3.3). */
const STATUS: Record<Refusal['code'], number> = {
  unauthorized: 401,
  invalid: 400,
  rejected: 409,
  stale_epoch: 409,
  not_live: 409,
  precondition: 409,
  internal: 500,
};

const statusOf = (reply: OperatorReply): number =>
  reply.ok ? 200 : STATUS[reply.code];

const send = (
  res: ServerResponse,
  status: number,
  body: OperatorReply,
): void => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

/** Compares two tokens without leaking the position of a mismatch. */
const tokenMatches = (given: unknown, expected: string): boolean => {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

/** The token from `Authorization: Bearer <token>`, if the header carries one. */
const bearerToken = (header: string | undefined): string | undefined =>
  header === undefined ? undefined : /^Bearer (.+)$/.exec(header)?.[1];

/**
 * Checks one parsed request body: the token first (constant time; the `Authorization` header wins
 * over the body's `token` field), then the verb schema. Returns the refusal to send, or the request.
 */
export const readRequest = (
  body: unknown,
  headerToken: string | undefined,
  token: string,
): { ok: true; request: OperatorRequest } | { ok: false; reply: Refusal } => {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return {
      ok: false,
      reply: {
        ok: false,
        code: 'invalid',
        message: 'request is not a JSON object',
      },
    };
  }
  const bodyToken =
    'token' in body ? (body as { token: unknown }).token : undefined;
  const given = headerToken ?? bodyToken;
  if (!tokenMatches(given, token)) {
    return {
      ok: false,
      reply: {
        ok: false,
        code: 'unauthorized',
        message: 'the Cycle token is missing or wrong',
      },
    };
  }
  // The token is already verified, so the schema sees it whether it came in the header or the body.
  const parsed = operatorRequestSchema.safeParse({ ...body, token });
  if (!parsed.success) {
    return {
      ok: false,
      reply: {
        ok: false,
        code: 'invalid',
        message: parsed.error.issues
          .map(
            (issue) => `${issue.path.join('.') || 'request'}: ${issue.message}`,
          )
          .join('; '),
      },
    };
  }
  return { ok: true, request: parsed.data };
};

/**
 * Serves the Operator verbs of one Cycle on a localhost HTTP port. One `POST` per verb: a JSON
 * object in, one JSON reply out. The port is OS-assigned on `127.0.0.1` only (PROTOCOL §3.3).
 */
export const startOperatorServer = (
  options: OperatorServerOptions,
): Promise<OperatorServer> => {
  const handle = (req: IncomingMessage, res: ServerResponse): void => {
    if (req.method !== 'POST') {
      res.setHeader('allow', 'POST');
      send(res, 405, { ok: false, code: 'invalid', message: 'use POST' });
      req.resume();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let oversized = false;
    req.on('data', (chunk: Buffer) => {
      if (oversized) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        oversized = true;
        chunks.length = 0;
        send(res, 413, {
          ok: false,
          code: 'invalid',
          message: `request body is larger than ${MAX_BODY_BYTES} bytes`,
        });
        return;
      }
      chunks.push(chunk);
    });
    req.on('error', () => res.destroy());
    req.on('end', () => {
      if (oversized) return;
      let body: unknown;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        send(res, 400, {
          ok: false,
          code: 'invalid',
          message: 'request is not JSON',
        });
        return;
      }
      const checked = readRequest(
        body,
        bearerToken(req.headers.authorization),
        options.token,
      );
      if (!checked.ok) {
        send(res, statusOf(checked.reply), checked.reply);
        return;
      }
      options
        .dispatch(checked.request)
        .then((answer) => send(res, statusOf(answer), answer))
        .catch((error: unknown) =>
          send(res, 500, {
            ok: false,
            code: 'internal',
            message: error instanceof Error ? error.message : String(error),
          }),
        );
    });
  };

  const server = createServer(handle);
  return new Promise<OperatorServer>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close();
        reject(new Error('the operator server has no TCP address'));
        return;
      }
      let closing: Promise<void> | undefined;
      resolve({
        url: `http://127.0.0.1:${address.port}`,
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
