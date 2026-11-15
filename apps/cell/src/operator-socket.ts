import { randomBytes, timingSafeEqual } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import {
  operatorRequestSchema,
  type OperatorReply,
  type OperatorRequest,
} from '@repo/factory-core/contracts/operator';

/** The largest request body the Operator endpoint reads; a verb is a short JSON object. */
export const MAX_BODY_BYTES = 1024 * 1024;

/** The per-Cycle token: 24 random bytes, hex. Never written to a log or a blob. */
export const newCycleToken = (): string => randomBytes(24).toString('hex');

export interface OperatorServerOptions {
  token: string;
  /** Answers one verb. Every reply is produced here, once the request has passed the checks. */
  dispatch: (request: OperatorRequest) => Promise<OperatorReply>;
}

export interface OperatorServer {
  /** The base URL the Operator posts to: `http://127.0.0.1:<port>`. */
  readonly url: string;
  /** Closes the listener and any open connection. Idempotent. */
  close(): Promise<void>;
}

type Refusal = Extract<OperatorReply, { ok: false }>;

/** The HTTP status of each refusal code; a verb's own answer is 200 or a domain refusal. */
const STATUS: Record<Refusal['code'], number> = {
  unauthorized: 401,
  invalid: 400,
  internal: 500,
  rejected: 409,
  stale_epoch: 409,
  not_live: 409,
  precondition: 409,
};

/** Compares two tokens without leaking the position of a mismatch. */
const tokenMatches = (given: unknown, expected: string): boolean => {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

/** The token a request presents: `Authorization: Bearer <token>` first, else the body's `token`. */
const presentedToken = (header: string | undefined, body: unknown): unknown => {
  const bearer = /^Bearer (.+)$/.exec(header ?? '');
  if (bearer) return bearer[1];
  return typeof body === 'object' && body !== null && 'token' in body
    ? (body as { token: unknown }).token
    : undefined;
};

/**
 * Checks one request: the token first (constant time), then the verb schema. The token may come
 * from the Bearer header or the body; the verified token then fills the body's `token` field before
 * the schema runs. Returns the refusal to send, or the parsed request.
 */
export const readRequest = (
  raw: string,
  token: string,
  authorization?: string,
):
  | { ok: true; request: OperatorRequest }
  | { ok: false; status: number; reply: Refusal } => {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return refuse({
      ok: false,
      code: 'invalid',
      message: 'request is not JSON',
    });
  }
  const given = presentedToken(authorization, body);
  if (!tokenMatches(given, token)) {
    return refuse({
      ok: false,
      code: 'unauthorized',
      message: 'the Cycle token is missing or wrong',
    });
  }
  const parsed = operatorRequestSchema.safeParse({
    ...(body as object),
    token: given,
  });
  if (!parsed.success) {
    return refuse({
      ok: false,
      code: 'invalid',
      message: parsed.error.issues
        .map(
          (issue) => `${issue.path.join('.') || 'request'}: ${issue.message}`,
        )
        .join('; '),
    });
  }
  return { ok: true, request: parsed.data };
};

const refuse = (
  reply: Refusal,
): { ok: false; status: number; reply: Refusal } => ({
  ok: false,
  status: STATUS[reply.code],
  reply,
});

const send = (
  res: ServerResponse,
  status: number,
  body: OperatorReply,
): void => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(`${JSON.stringify(body)}\n`);
};

/** Reads the whole body, or `null` when it grows past the limit. */
const readBody = (req: IncomingMessage): Promise<string | null> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk: Buffer) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });

/**
 * Serves the Operator verbs of one Cycle on a localhost HTTP endpoint. Bound to 127.0.0.1 on an
 * OS-assigned port; only `POST` is accepted, with a JSON body. The reply is an `OperatorReply`.
 */
export const startOperatorServer = (
  options: OperatorServerOptions,
): Promise<OperatorServer> => {
  const server: Server = createServer((req, res) => {
    void handle(req, res, options).catch(() => {
      if (!res.headersSent)
        send(res, 500, {
          ok: false,
          code: 'internal',
          message: 'the Cell could not read the request',
        });
    });
  });

  return new Promise<OperatorServer>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close();
        reject(new Error('the operator endpoint did not bind a TCP port'));
        return;
      }
      let closed: Promise<void> | undefined;
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        close: () => {
          closed ??= new Promise<void>((done) => {
            server.closeAllConnections();
            server.close(() => done());
          });
          return closed;
        },
      });
    });
  });
};

const handle = async (
  req: IncomingMessage,
  res: ServerResponse,
  options: OperatorServerOptions,
): Promise<void> => {
  if (req.method !== 'POST') {
    res.setHeader('allow', 'POST');
    send(res, 405, {
      ok: false,
      code: 'invalid',
      message: 'the Operator endpoint takes POST only',
    });
    req.resume();
    return;
  }
  const raw = await readBody(req);
  if (raw === null) {
    send(res, 413, {
      ok: false,
      code: 'invalid',
      message: 'the request is larger than 1 MiB',
    });
    return;
  }
  const checked = readRequest(raw, options.token, req.headers.authorization);
  if (!checked.ok) {
    send(res, checked.status, checked.reply);
    return;
  }
  try {
    const answer = await options.dispatch(checked.request);
    send(res, answer.ok ? 200 : STATUS[answer.code], answer);
  } catch (error: unknown) {
    send(res, 500, {
      ok: false,
      code: 'internal',
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
