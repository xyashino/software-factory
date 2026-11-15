import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FactoryClient } from '@repo/factory-core/contracts/client';
import {
  DISCOVERY_FILE_NAME,
  parseDiscovery,
} from '@repo/factory-core/contracts/discovery';
import { httpClient } from '@repo/factory-server/testing/local-http';
import {
  captureOutput,
  inheritedEnv,
  signalGroup,
  spawnGroup,
  waitFor,
  type OutputCapture,
} from './process';

/** The `factory-server` entry point, run as a real process. */
export const SERVER_MAIN = fileURLToPath(
  new URL('../../../../../server/src/main.ts', import.meta.url),
);

/** Timing knobs for the whole suite (ROADMAP v2-15): short, with self-fence well below the lease TTL. */
export const SUITE_TIMING = {
  leaseTtlMs: 3_000,
  heartbeatMs: 300,
  selfFenceMs: 2_000,
  claimTickMs: 100,
} as const;

export interface FactoryOptions {
  dataDir: string;
  /** The environment the server runs in: PATH with the fake `gh`, the suite's knobs. */
  env: Record<string, string>;
}

/** A `factory-server` process of the suite. */
export interface RunningFactory {
  readonly dataDir: string;
  /** The supervisor client, the way the Supervisor and the tests talk to the Factory (local token). */
  readonly client: FactoryClient;
  /** The HTTP address of the server: the Cells' `factory_url` in remote mode, through the test's proxies. */
  readonly remoteUrl: string;
  /** What the process printed so far. */
  output(): string;
  /** Asks the server to stop (SIGTERM) and waits for it to exit. */
  stop(): Promise<void>;
  /** Kills the server's group with SIGKILL and waits for it to exit. */
  kill9(): Promise<void>;
}

const LISTEN_LINE = /factory-server: listening on (http:\/\/\S+)/;

/** The discovery file's content, or undefined while it is absent or damaged. */
const discoveryOf = (dataDir: string) => {
  try {
    return parseDiscovery(
      readFileSync(join(dataDir, DISCOVERY_FILE_NAME), 'utf8'),
    );
  } catch {
    return undefined;
  }
};

/**
 * Starts `factory-server` on `dataDir` and returns once it answers. Every server of the suite listens on
 * a free loopback port; its address comes from its own "listening on" line, and its local token from the
 * discovery file it has just written.
 */
export const startFactory = async (
  options: FactoryOptions,
): Promise<RunningFactory> => {
  const env: Record<string, string> = {
    ...inheritedEnv(),
    ...options.env,
    FACTORY_DATA_DIR: options.dataDir,
    FACTORY_BIND: '127.0.0.1:0',
  };
  const child = spawnGroup(['bun', SERVER_MAIN], env);
  const output: OutputCapture = captureOutput(child.stdout);
  const errors: OutputCapture = captureOutput(child.stderr);

  let exited = false;
  void child.exited.then(() => {
    exited = true;
  });
  let remoteUrl: string | undefined;
  await waitFor(() => {
    if (exited) {
      throw new Error(
        `factory-server exited before it answered:\n${output.text()}${errors.text()}`,
      );
    }
    remoteUrl = LISTEN_LINE.exec(output.text())?.[1];
    return (
      remoteUrl !== undefined && discoveryOf(options.dataDir) !== undefined
    );
  }, 'factory-server to listen and write its discovery file');
  const discovery = discoveryOf(options.dataDir);
  if (remoteUrl === undefined || discovery === undefined) {
    throw new Error('factory-server did not start');
  }
  const client = httpClient(remoteUrl, discovery.token);

  const answers = async (): Promise<boolean> => {
    try {
      await client.call('board', {});
      return true;
    } catch {
      return false;
    }
  };
  await waitFor(answers, 'factory-server to answer over HTTP');

  const stopped = (): boolean => exited;
  return {
    dataDir: options.dataDir,
    client,
    remoteUrl,
    output: () => output.text() + errors.text(),
    async stop() {
      if (!stopped()) signalGroup(child.pid, 'SIGTERM');
      await child.exited;
    },
    async kill9() {
      if (!stopped()) signalGroup(child.pid, 'SIGKILL');
      await child.exited;
    },
  };
};
