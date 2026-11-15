import { randomBytes, timingSafeEqual } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { Socket } from 'node:net';
import {
  operatorReplySchema,
  operatorRequestSchema,
  type OperatorReply,
  type OperatorRequest,
} from '@repo/factory-core/contracts/operator';

/** The largest request body the Operator endpoint reads. Every verb is far smaller (PROTOCOL §3.3). */
export const MAX_BODY_BYTES = 1024 * 1024;

/** The per-Cycle token: 24 random bytes, hex. Never written to a log or a blob. */
export const newCycleToken = (): string => randomBytes(24).toString('hex');

export interface OperatorServerOptions {
  token: string;
  /** Answers one verb. Every reply is produced here, once the request has passed the checks. */
  dispatch: (request: OperatorRequest) => Promise<OperatorReply>;
}

export interface OperatorServer {
  /** The base URL the Operator posts to, e.g. `http://127.0.0.1:53124`. */
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

/** The HTTP status a refusal or a reply of this code carries. */
const statusOf = (reply: OperatorReply): number => {
  if (reply.ok) return 200;
  switch (reply.code) {
    case 'unauthorized':
      return 401;
    case 'invalid':
      return 400;
    case 'internal':
      return 500;
    default:
      return 409;
  }
};

/** The Bearer token of an `Authorization` header, if it carries one. */
const bearerOf = (header: string | undefined): string | undefined =>
  /^Bearer (.+)$/.exec(header ?? '')?.[1];

/**
 * Checks one request body: the token first (constant time), then the verb schema. The token comes
 * from the `Authorization: Bearer` header when present, else from the body's `token` field. Returns
 * the refusal to send, or the parsed request.
 */
export const readRequest = (
  body: string,
  headerToken: string | undefined,
  token: string,
):
  | { ok: true; request: OperatorRequest }
  | { ok: false; reply: Extract<OperatorReply, { ok: false }> } => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return {
      ok: false,
      reply: { ok: false, code: 'invalid', message: 'request is not JSON' },
    };
  }
  const bodyToken =
    typeof parsed === 'object' && parsed !== null && 'token' in parsed
      ? (parsed as { token: unknown }).token
      : undefined;
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
  // The verified token is the one the schema checks, so a request that sent it only in the header
  // passes the same schema as one that sent it in the body.
  const verified =
    typeof parsed === 'object' && parsed !== null
      ? { ...parsed, token: given }
      : parsed;
  const checked = operatorRequestSchema.safeParse(verified);
  if (!checked.success) {
    return {
      ok: false,
      reply: {
        ok: false,
        code: 'invalid',
        message: checked.error.issues
          .map(
            (issue) => `${issue.path.join('.') || 'request'}: ${issue.message}`,
          )
          .join('; '),
      },
    };
  }
  return { ok: true, request: checked.data };
};

/** Reads the whole body. Resolves `undefined` when it is larger than `MAX_BODY_BYTES`. */
const readBody = (request: IncomingMessage): Promise<string | undefined> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size <= MAX_BODY_BYTES) chunks.push(chunk);
    });
    request.on('end', () =>
      resolve(
        size > MAX_BODY_BYTES
          ? undefined
          : Buffer.concat(chunks).toString('utf8'),
      ),
    );
    request.on('error', reject);
  });

const send = (
  response: ServerResponse,
  status: number,
  body: OperatorReply,
): void => {
  if (response.headersSent) return;
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
};

/**
 * Serves the Operator verbs of one Cycle on a localhost HTTP port: `POST` a JSON verb, get one
 * `OperatorReply` back. The server binds `127.0.0.1` on an OS-assigned port, so it has no socket
 * file, no path length limit and no file mode to set. It lives as long as the Cycle does.
 */
export const startOperatorServer = (
  options: OperatorServerOptions,
): Promise<OperatorServer> => {
  const open = new Set<Socket>();

  const handle = async (
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> => {
    if (request.method !== 'POST') {
      response.setHeader('allow', 'POST');
      send(response, 405, {
        ok: false,
        code: 'invalid',
        message: 'the Operator endpoint takes POST only',
      });
      return;
    }
    const body = await readBody(request);
    if (body === undefined) {
      send(response, 413, {
        ok: false,
        code: 'invalid',
        message: `the request is larger than ${MAX_BODY_BYTES} bytes`,
      });
      return;
    }
    const checked = readRequest(
      body,
      bearerOf(request.headers.authorization),
      options.token,
    );
    if (!checked.ok) {
      send(response, statusOf(checked.reply), checked.reply);
      return;
    }
    try {
      const answer = await options.dispatch(checked.request);
      send(response, statusOf(answer), operatorReplySchema.parse(answer));
    } catch (error) {
      send(response, 500, {
        ok: false,
        code: 'internal',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const server: Server = createServer((request, response) => {
    handle(request, response).catch((error: unknown) =>
      send(response, 500, {
        ok: false,
        code: 'internal',
        message: error instanceof Error ? error.message : String(error),
      }),
    );
  });
  server.on('connection', (socket) => {
    open.add(socket);
    socket.once('close', () => open.delete(socket));
  });

  return new Promise<OperatorServer>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close();
        reject(new Error('the operator endpoint has no TCP address'));
        return;
      }
      let closed = false;
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        close: () =>
          new Promise<void>((done) => {
            if (closed) return done();
            closed = true;
            for (const socket of open) socket.destroy();
            server.close(() => done());
          }),
      });
    });
  });
};
