import { randomBytes, timingSafeEqual } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { type AddressInfo, type Socket } from 'node:net';
import {
  operatorRequestSchema,
  type OperatorReply,
  type OperatorRequest,
} from '@repo/factory-core/contracts/operator';

/** The loopback address the Operator endpoint binds: this machine only. */
export const OPERATOR_HOST = '127.0.0.1';

/** The largest request body the endpoint reads; a verb is a few kilobytes at most. */
export const MAX_BODY_BYTES = 1024 * 1024;

/** The per-Cycle token: 24 random bytes, hex. Never written to a log or a blob. */
export const newCycleToken = (): string => randomBytes(24).toString('hex');

export interface OperatorServerOptions {
  token: string;
  /** Answers one verb. Every reply is produced here, once the request has passed the checks. */
  dispatch: (request: OperatorRequest) => Promise<OperatorReply>;
  /**
   * The port to bind. Omitted, the server takes an ephemeral one. A re-adopted pane has its
   * `FACTORY_OPERATOR_URL` baked in at launch, so its server binds the port the pane already knows.
   * A port held by someone else rejects the start (EADDRINUSE).
   */
  port?: number;
}

export interface OperatorServer {
  /** The base URL the Operator CLI posts to: `http://127.0.0.1:<port>`. */
  readonly url: string;
  /** Closes the listener and any open connection. Idempotent. */
  close(): Promise<void>;
}

// Compares two tokens in constant time; a length mismatch is refused without comparing bytes.
const tokenMatches = (given: unknown, expected: string): boolean => {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

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

/**
 * Checks one request body: the token first (constant time), then the verb schema. The token comes
 * from the `Authorization: Bearer` header when one is sent, else from the body's `token` field.
 * Returns the refusal to send, or the parsed request.
 */
export const readRequest = (
  line: string,
  headerToken: string | undefined,
  token: string,
):
  | { ok: true; request: OperatorRequest }
  | { ok: false; reply: Extract<OperatorReply, { ok: false }> } => {
  let body: unknown;
  try {
    body = JSON.parse(line);
  } catch {
    return {
      ok: false,
      reply: { ok: false, code: 'invalid', message: 'request is not JSON' },
    };
  }
  const bodyToken =
    typeof body === 'object' && body !== null && 'token' in body
      ? (body as { token: unknown }).token
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
  const parsed = operatorRequestSchema.safeParse(body);
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

// The bearer token of an `Authorization` header, or undefined when the header is not one.
const bearerOf = (header: string | undefined): string | undefined => {
  const match = /^Bearer (.+)$/.exec(header ?? '');
  return match?.[1];
};

const send = (res: ServerResponse, body: OperatorReply): void => {
  res.writeHead(statusOf(body), { 'content-type': 'application/json' });
  res.end(`${JSON.stringify(body)}\n`);
};

const readBody = (req: IncomingMessage): Promise<string | undefined> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        resolve(undefined);
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
 * Serves the Operator verbs of one Cycle on an ephemeral localhost HTTP port. One `POST /` per verb:
 * a JSON body in, one JSON reply out. The server binds 127.0.0.1 only, so it is reachable from this
 * machine and never from the network.
 */
export const startOperatorServer = (
  options: OperatorServerOptions,
): Promise<OperatorServer> => {
  const open = new Set<Socket>();
  const server: Server = createServer((req, res) => {
    if (req.url !== '/') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(
        `${JSON.stringify({ ok: false, code: 'invalid', message: 'unknown path' })}\n`,
      );
      req.resume();
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(405, {
        'content-type': 'application/json',
        allow: 'POST',
      });
      res.end(
        `${JSON.stringify({ ok: false, code: 'invalid', message: 'the Operator endpoint takes POST only' })}\n`,
      );
      req.resume();
      return;
    }
    readBody(req)
      .then((line) => {
        if (line === undefined) {
          res.writeHead(413, {
            'content-type': 'application/json',
            connection: 'close',
          });
          res.end(
            `${JSON.stringify({ ok: false, code: 'invalid', message: 'request is too large' })}\n`,
          );
          return;
        }
        const checked = readRequest(
          line,
          bearerOf(req.headers.authorization),
          options.token,
        );
        if (!checked.ok) {
          send(res, checked.reply);
          return;
        }
        return options
          .dispatch(checked.request)
          .then((answer) => send(res, answer))
          .catch((error: unknown) =>
            send(res, {
              ok: false,
              code: 'internal',
              message: error instanceof Error ? error.message : String(error),
            }),
          );
      })
      .catch((error: unknown) =>
        send(res, {
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
    server.listen(options.port ?? 0, OPERATOR_HOST, () => {
      const { port } = server.address() as AddressInfo;
      let closed = false;
      resolve({
        url: `http://${OPERATOR_HOST}:${port}`,
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
