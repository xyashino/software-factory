import { createConnection } from 'node:net';
import type {
  OperatorReply,
  OperatorVerb,
} from '@repo/factory-core/contracts/operator';

/** The one place this CLI touches the network stack: the Cell's unix socket, nothing else. */
export const SOCKET_ENV = 'FACTORY_OPERATOR_SOCKET';
export const TOKEN_ENV = 'FACTORY_CYCLE_TOKEN';

/** A failure the Operator must see: its message, and the exit code it maps to. */
export class OperatorError extends Error {
  readonly exitCode: number;
  constructor(message: string, exitCode: number) {
    super(message);
    this.name = 'OperatorError';
    this.exitCode = exitCode;
  }
}

/**
 * Sends one request to the Cell and reads one reply. Connection failures and a closed socket are
 * `OperatorError`s with exit code 3; a refusal from the Cell keeps its own message.
 */
export const callCell = (
  socketPath: string,
  request: OperatorVerb,
  token: string,
): Promise<OperatorReply> =>
  new Promise<OperatorReply>((resolve, reject) => {
    const socket = createConnection(socketPath);
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('connect', () => {
      socket.write(`${JSON.stringify({ ...request, token })}\n`);
    });
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      const end = buffer.indexOf('\n');
      if (end < 0) return;
      socket.end();
      try {
        resolve(JSON.parse(buffer.slice(0, end)) as OperatorReply);
      } catch {
        reject(
          new OperatorError('the Cell sent a reply this CLI cannot read', 3),
        );
      }
    });
    socket.on('end', () => {
      if (buffer.indexOf('\n') < 0) {
        reject(
          new OperatorError('the Cell closed the socket without a reply', 3),
        );
      }
    });
    socket.on('error', (error: NodeJS.ErrnoException) => {
      reject(
        new OperatorError(
          `cannot reach the Cell at ${socketPath}: ${error.code ?? error.message}`,
          3,
        ),
      );
    });
  });
