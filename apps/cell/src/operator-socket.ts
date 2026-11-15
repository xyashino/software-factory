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

/** The largest request body the Operator endpoint reads; a bigger one is refused with 413. */
export const MAX_BODY_BYTES = 1024 * 1024;

/** The per-Cycle token: 24 random bytes, hex. Never written to a log or a blob. */
export const newCycleToken = (): string => randomBytes(24).toString('hex');

export interface OperatorServerOptions {
  token: string;
  /** Answers one verb. Every reply is produced here, once the request has passed the checks. */
  dispatch: (request: OperatorRequest) => Promise<OperatorReply>;
}

export interface OperatorServer {
  /** The base URL `factory-operator` posts to, e.g. `http://127.0.0.1:53012`. */
  readonly url: string;
  /** Closes the listener and any open connection. Idempotent. */
  close(): Promise<void>;
}

/** The HTTP status of each refusal the checks can make (PROTOCOL §3.3). */
const REFUSAL_STATUS: Record<'unauthorized' | 'invalid', number> = {
  unauthorized: 401,
  invalid: 400,
};

/** Compares two tokens without leaking the position of a mismatch. */
const tokenMatches = (given: unknown, expected: string): boolean => {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

/** The token of an `Authorization: Bearer <token>` header, or undefined when there is none. */
const bearerToken = (header: string | undefined): string | undefined => {
  const match = /^Bearer\s+(.+)$/i.exec(header ?? '');
  return match?.[1];
};

/**
 * Checks one request body: the token first (constant time), then the verb schema. The token comes
 * from the Bearer header when one is sent, else from the body's `token` field. Returns the refusal
 * to send, or the parsed request.
 */
export const readRequest = (
  raw: string,
  headerToken: string | undefined,
  token: string,
):
  | { ok: true; request: OperatorRequest }
  | {
      ok: false;
      status: number;
      reply: Extract<OperatorReply, { ok: false }>;
    } => {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      status: REFUSAL_STATUS.invalid,
      reply: { ok: false, code: 'invalid', message: 'request is not JSON' },
    };
  }
  const object =
    typeof body === 'object' && body !== null
      ? (body as Record<string, unknown>)
      : undefined;
  const given = headerToken ?? object?.token;
  if (!tokenMatches(given, token)) {
    return {
      ok: false,
      status: REFUSAL_STATUS.unauthorized,
      reply: {
        ok: false,
        code: 'unauthorized',
        message: 'the Cycle token is missing or wrong',
      },
    };
  }
  // The header token stands in for a missing body token, so a header-only request still parses.
  const parsed = operatorRequestSchema.safeParse(
    object !== undefined ? { ...object, token: given } : body,
  );
  if (!parsed.success) {
    return {
      ok: false,
      status: REFUSAL_STATUS.invalid,
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

const send = (
  res: ServerResponse,
  status: number,
  body: OperatorReply,
): void => {
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(JSON.stringify(body)),
  });
  res.end(JSON.stringify(body));
};

/** Reads the body up to `MAX_BODY_BYTES`. Rejects with `TOO_LARGE` past the cap. */
const TOO_LARGE = 'TOO_LARGE';
const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error(TOO_LARGE));
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (size <= MAX_BODY_BYTES)
        resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });

/**
 * Serves the Operator verbs of one Cycle on an ephemeral localhost HTTP port (PROTOCOL §3.3). One
 * `POST` per verb: a JSON body in, one JSON reply out. Bound to `127.0.0.1` only, so no other
 * machine can reach it; the Cycle token is the gate.
 */
export const startOperatorServer = (
  options: OperatorServerOptions,
): Promise<OperatorServer> => {
  const handle = async (
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> => {
    if (req.method !== 'POST') {
      send(res, 405, {
        ok: false,
        code: 'invalid',
        message: 'the Operator API takes POST only',
      });
      return;
    }
    let raw: string;
    try {
      raw = await readBody(req);
    } catch (error) {
      const tooLarge = error instanceof Error && error.message === TOO_LARGE;
      send(res, tooLarge ? 413 : 400, {
        ok: false,
        code: 'invalid',
        message: tooLarge
          ? `request body is over ${MAX_BODY_BYTES} bytes`
          : 'request could not be read',
      });
      return;
    }
    const checked = readRequest(
      raw,
      bearerToken(req.headers.authorization),
      options.token,
    );
    if (!checked.ok) {
      send(res, checked.status, checked.reply);
      return;
    }
    try {
      send(res, 200, await options.dispatch(checked.request));
    } catch (error) {
      send(res, 500, {
        ok: false,
        code: 'internal',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const server = createServer((req, res) => {
    void handle(req, res);
  });

  return new Promise<OperatorServer>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close();
        reject(new Error('the Operator endpoint has no TCP address'));
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
