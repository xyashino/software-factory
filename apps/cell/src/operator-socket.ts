import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, unlinkSync, chmodSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import {
  operatorRequestSchema,
  type OperatorReply,
  type OperatorRequest,
} from '@repo/factory-core/contracts/operator';

/** The file mode of the Operator socket: the operating-system account only (PROTOCOL §3.3). */
export const OPERATOR_SOCKET_MODE = 0o600;

/** A unix socket path is limited to about 108 bytes; a longer one is refused, not truncated. */
export const MAX_SOCKET_PATH = 100;

/** The per-Cycle token: 24 random bytes, hex. Never written to a log or a blob. */
export const newCycleToken = (): string => randomBytes(24).toString('hex');

export interface OperatorSocketOptions {
  path: string;
  token: string;
  /** Answers one verb. Every reply is produced here, once the request has passed the checks. */
  dispatch: (request: OperatorRequest) => Promise<OperatorReply>;
}

export interface OperatorSocket {
  readonly path: string;
  /** Closes the listener and removes the socket file. Idempotent. */
  close(): Promise<void>;
}

const reply = (socket: Socket, body: OperatorReply): void => {
  socket.end(`${JSON.stringify(body)}\n`);
};

/** Compares two tokens without leaking the position of a mismatch. */
const tokenMatches = (given: unknown, expected: string): boolean => {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

/**
 * Checks one request line: the token first (constant time), then the verb schema. Returns the
 * refusal to send, or the parsed request.
 */
export const readRequest = (
  line: string,
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
  const given =
    typeof body === 'object' && body !== null && 'token' in body
      ? (body as { token: unknown }).token
      : undefined;
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

/**
 * Serves the Operator verbs of one Cycle on a unix socket. One request per connection: a JSON line
 * in, one JSON line out. The socket is bound under a umask that keeps it private, then chmod'd to
 * 0600, so no other account ever sees it open (PROTOCOL §3.3, security.md).
 */
export const startOperatorSocket = (
  options: OperatorSocketOptions,
): Promise<OperatorSocket> => {
  if (options.path.length > MAX_SOCKET_PATH) {
    return Promise.reject(
      new Error(
        `operator socket path is too long: ${options.path.length} bytes`,
      ),
    );
  }
  if (existsSync(options.path)) unlinkSync(options.path);

  const open = new Set<Socket>();
  const server: Server = createServer((socket) => {
    open.add(socket);
    socket.once('close', () => open.delete(socket));
    let buffer = '';
    let handled = false;
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      if (handled) return;
      buffer += chunk;
      const end = buffer.indexOf('\n');
      if (end < 0) return;
      handled = true;
      const checked = readRequest(buffer.slice(0, end), options.token);
      if (!checked.ok) {
        reply(socket, checked.reply);
        return;
      }
      options
        .dispatch(checked.request)
        .then((answer) => reply(socket, answer))
        .catch((error: unknown) =>
          reply(socket, {
            ok: false,
            code: 'internal',
            message: error instanceof Error ? error.message : String(error),
          }),
        );
    });
    socket.on('error', () => socket.destroy());
  });

  return new Promise<OperatorSocket>((resolve, reject) => {
    const previousUmask = process.umask(0o777 & ~OPERATOR_SOCKET_MODE);
    server.once('error', (error) => {
      process.umask(previousUmask);
      reject(error);
    });
    server.listen(options.path, () => {
      process.umask(previousUmask);
      chmodSync(options.path, OPERATOR_SOCKET_MODE);
      let closed = false;
      resolve({
        path: options.path,
        close: () =>
          new Promise<void>((done) => {
            if (closed) return done();
            closed = true;
            for (const socket of open) socket.destroy();
            server.close(() => {
              if (existsSync(options.path)) unlinkSync(options.path);
              done();
            });
          }),
      });
    });
  });
};
