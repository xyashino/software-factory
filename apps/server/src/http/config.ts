/** The default TCP address of the remote listener (PROTOCOL §2): loopback only. */
export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_PORT = 7878;

export interface RemoteConfig {
  /** True when `FACTORY_REMOTE=1`. Local mode is the default: no TCP listener at all. */
  enabled: boolean;
  hostname: string;
  port: number;
}

/**
 * Reads the remote switch and the bind address (PROTOCOL §2). `FACTORY_REMOTE=1` turns the TCP
 * listener on; `FACTORY_BIND=host[:port]` (`[v6]:port` for IPv6) sets where it binds and defaults to
 * `127.0.0.1:7878`. `FACTORY_BIND` without `FACTORY_REMOTE=1` is refused, so a bind address can never
 * be set and silently ignored.
 */
export const remoteConfigFrom = (env: NodeJS.ProcessEnv): RemoteConfig => {
  const enabled = env.FACTORY_REMOTE === '1';
  const bind = env.FACTORY_BIND;
  if (bind !== undefined && !enabled) {
    throw new Error('FACTORY_BIND needs FACTORY_REMOTE=1');
  }
  const { hostname, port } = parseBind(
    bind ?? `${DEFAULT_HOST}:${DEFAULT_PORT}`,
  );
  return { enabled, hostname, port };
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
