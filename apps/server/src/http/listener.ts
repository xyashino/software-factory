import type { Runtime } from '@repo/factory-runtime/composition';
import { createHttpApp } from './app';

/**
 * Bun's idle timeout limit, in seconds. A claim long-poll waits up to 25 s and an SSE stream waits
 * for commits without end, so the connection must outlive the default idle timeout (10 s).
 */
export const IDLE_TIMEOUT_S = 255;

export interface HttpListener {
  /** The address the listener answers on, e.g. `http://127.0.0.1:7878`. */
  readonly url: string;
  /** Closes every connection and the port. Idempotent. */
  stop(): Promise<void>;
}

/**
 * Serves the runtime on TCP (PROTOCOL §2). It is started beside the Unix socket only when remote mode
 * is on; the socket listener is unaffected. The caller holds the writer lock, as for the socket.
 */
export const startHttpListener = (options: {
  runtime: Runtime;
  hostname: string;
  port: number;
}): HttpListener => {
  const app = createHttpApp(options.runtime);
  const server = Bun.serve({
    hostname: options.hostname,
    port: options.port,
    idleTimeout: IDLE_TIMEOUT_S,
    fetch: app.fetch,
  });
  const host = options.hostname.includes(':')
    ? `[${options.hostname}]`
    : options.hostname;
  let stopped = false;
  return {
    url: `http://${host}:${server.port}`,
    stop: async () => {
      if (stopped) return;
      stopped = true;
      await server.stop(true);
    },
  };
};
