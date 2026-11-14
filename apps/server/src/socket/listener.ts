import { chmodSync, existsSync, unlinkSync } from 'node:fs';
import type { Runtime } from '@repo/factory-runtime/composition';
import { serveRequest } from './serve';

/** The file mode of the socket: the operating-system account only (PROTOCOL §2). */
export const SOCKET_MODE = 0o600;

export interface SocketListener {
  readonly socketPath: string;
  /** Closes the listener and removes the socket file. Idempotent. */
  stop(): Promise<void>;
}

/**
 * Serves the runtime on a Unix socket and nothing else: no port, no hostname (PROTOCOL §2). The
 * caller holds the writer lock, which proves no other server owns the path, so a file already there
 * is stale and is removed. The umask is tightened around the bind so the socket is never group- or
 * world-accessible, even for an instant; the mode is set again after the bind.
 */
export const startSocketListener = (options: {
  runtime: Runtime;
  socketPath: string;
}): SocketListener => {
  const { runtime, socketPath } = options;
  if (existsSync(socketPath)) unlinkSync(socketPath);

  const previousUmask = process.umask(0o777 & ~SOCKET_MODE);
  let server: ReturnType<typeof Bun.serve>;
  try {
    server = Bun.serve({
      unix: socketPath,
      fetch: (request) => serveRequest(runtime, request),
    });
  } finally {
    process.umask(previousUmask);
  }
  chmodSync(socketPath, SOCKET_MODE);

  let stopped = false;
  return {
    socketPath,
    stop: async () => {
      if (stopped) return;
      stopped = true;
      await server.stop(true);
      if (existsSync(socketPath)) unlinkSync(socketPath);
    },
  };
};
