import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FactoryClient } from '@repo/factory-core/contracts/client';
import { socketFactoryClient } from '@repo/factory-server/socket/client';
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

/** The socket inside the data directory (PROTOCOL §2). */
const SOCKET = 'factory.sock';

/** Timing knobs for the whole suite (ROADMAP v2-15): short, with self-fence well below the lease TTL. */
export const SUITE_TIMING = {
  leaseTtlMs: 3_000,
  heartbeatMs: 300,
  reaperMs: 200,
  selfFenceMs: 2_000,
  claimTickMs: 100,
} as const;

export interface FactoryOptions {
  dataDir: string;
  /** The environment the server runs in: PATH with the fake `gh`, the suite's knobs. */
  env: Record<string, string>;
  /** Also serve HTTP (remote mode) on a free loopback port. */
  remote?: boolean;
}

/** A `factory-server` process of the suite. */
export interface RunningFactory {
  readonly dataDir: string;
  /** The socket client, the way the Supervisor and the tests talk to the Factory. */
  readonly client: FactoryClient;
  /** The HTTP address of the remote listener, when it runs. */
  readonly remoteUrl: string | undefined;
  /** What the process printed so far. */
  output(): string;
  /** Asks the server to stop (SIGTERM) and waits for it to exit. */
  stop(): Promise<void>;
  /** Kills the server's group with SIGKILL and waits for it to exit. */
  kill9(): Promise<void>;
}

const REMOTE_LINE = /factory-server: remote listening on (http:\/\/\S+)/;

/** Starts `factory-server` on `dataDir` and returns once its socket answers. */
export const startFactory = async (
  options: FactoryOptions,
): Promise<RunningFactory> => {
  const env: Record<string, string> = {
    ...inheritedEnv(),
    ...options.env,
    FACTORY_DATA_DIR: options.dataDir,
    ...(options.remote
      ? { FACTORY_REMOTE: '1', FACTORY_BIND: '127.0.0.1:0' }
      : {}),
  };
  const child = spawnGroup(['bun', SERVER_MAIN], env);
  const output: OutputCapture = captureOutput(child.stdout);
  const errors: OutputCapture = captureOutput(child.stderr);
  const client = socketFactoryClient({
    socketPath: join(options.dataDir, SOCKET),
  });

  const answers = async (): Promise<boolean> => {
    try {
      await client.call('board', {});
      return true;
    } catch {
      return false;
    }
  };
  let exited = false;
  void child.exited.then(() => {
    exited = true;
  });
  await waitFor(async () => {
    if (exited) {
      throw new Error(
        `factory-server exited before it answered:\n${output.text()}${errors.text()}`,
      );
    }
    return answers();
  }, 'factory-server to answer on its socket');

  let remoteUrl: string | undefined;
  if (options.remote) {
    await waitFor(() => {
      const match = REMOTE_LINE.exec(output.text());
      if (match) remoteUrl = match[1];
      return remoteUrl !== undefined;
    }, 'the remote listener to start');
  }

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
