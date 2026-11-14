import { fileURLToPath } from 'node:url';

/**
 * The `factory-server` entry point of this checkout (apps/server/src/main.ts). The CLI runs it as a
 * subprocess and never imports it (STRUCTURE §3). `serverBin` in the config file overrides it.
 */
export const DEFAULT_SERVER_BIN = fileURLToPath(
  new URL('../../server/src/main.ts', import.meta.url),
);
