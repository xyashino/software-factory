/** The default address of the HTTP listener: loopback only. */
export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_PORT = 7878;

export interface ListenerConfig {
  hostname: string;
  port: number;
  /**
   * `GITHUB_WEBHOOK_SECRET`: the HMAC key of `POST /v1/webhooks/github`. Unset, the
   * webhook answers `503 not_configured`.
   */
  githubWebhookSecret?: string;
}

/**
 * Reads the bind address. `FACTORY_BIND=host[:port]` (`[v6]:port` for IPv6) sets where
 * the listener binds and defaults to `127.0.0.1:7878`. Port 0 asks the system for a free port (tests).
 * The listener always runs: there is no switch to turn it on.
 */
export const listenerConfigFrom = (env: NodeJS.ProcessEnv): ListenerConfig => {
  const { hostname, port } = parseBind(
    env.FACTORY_BIND ?? `${DEFAULT_HOST}:${DEFAULT_PORT}`,
  );
  const secret = env.GITHUB_WEBHOOK_SECRET;
  return {
    hostname,
    port,
    ...(secret ? { githubWebhookSecret: secret } : {}),
  };
};

/** `host:port` or `[v6]:port`. Port 0 asks the system for a free port (tests). */
export const parseBind = (bind: string): { hostname: string; port: number } => {
  const colon = bind.lastIndexOf(':');
  const rawHost = colon <= 0 ? '' : bind.slice(0, colon);
  const hostname = rawHost.replace(/^\[(.*)\]$/, '$1');
  const portText = colon <= 0 ? '' : bind.slice(colon + 1);
  const port = Number(portText);
  if (
    hostname.length === 0 ||
    !/^\d+$/.test(portText) ||
    !Number.isInteger(port) ||
    port > 65_535
  ) {
    throw new Error(`FACTORY_BIND must be host:port, got "${bind}"`);
  }
  return { hostname, port };
};
