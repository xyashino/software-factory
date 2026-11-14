import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  WriterHeldError,
  type OpenedRuntime,
} from '@repo/factory-runtime/open-runtime';
import { openForAdmin, runAdminCommand } from './admin-command';
import { runOnce } from './once';
import { startHttpListener, type HttpListener } from './http/listener';
import { remoteConfigFrom, type RemoteConfig } from './http/config';
import { startSocketListener, type SocketListener } from './socket/listener';
import { usage } from './usage';

/** The socket inside the data directory (PROTOCOL §2). */
export const SOCKET_FILE_NAME = 'factory.sock';

/** The data directory: `$FACTORY_DATA_DIR`, else `~/.local/share/factory` (STORAGE §1). */
export const dataDirFromEnv = (env: NodeJS.ProcessEnv): string =>
  env.FACTORY_DATA_DIR ?? join(homedir(), '.local', 'share', 'factory');

/**
 * The data directory: `--data-dir <path>` (or `--data-dir=<path>`) wins over `$FACTORY_DATA_DIR`,
 * which wins over `~/.local/share/factory` (STORAGE §1).
 */
export const resolveDataDir = (
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
): string => {
  const index = argv.indexOf('--data-dir');
  const inline = argv.find((arg) => arg.startsWith('--data-dir='));
  const flag = inline?.slice('--data-dir='.length) ?? argv[index + 1];
  if (index !== -1 || inline !== undefined) {
    if (flag && flag.length > 0) return flag;
  }
  return dataDirFromEnv(env);
};

const stripDataDirFlag = (argv: readonly string[]): string[] => {
  const result: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === '--data-dir') {
      index += 1;
      continue;
    }
    if (arg.startsWith('--data-dir=')) continue;
    result.push(arg);
  }
  return result;
};

/**
 * `factory-server`: the single writer of a Factory data directory (STORAGE §1). It takes the writer
 * lock, runs the runtime's boot grace and reaper, serves the socket, and shuts down cleanly on
 * SIGINT or SIGTERM: the listener stops, the socket file is removed, the lock is released.
 *
 * The signal handlers are installed before anything is opened, so a signal that arrives while the
 * server starts still goes through the same shutdown, and the socket file is never left behind.
 */
const main = async (): Promise<void> => {
  if (process.argv.includes('--help')) {
    console.log(usage);
    return;
  }
  const rawArgs = process.argv.slice(2);
  const dataDir = resolveDataDir(rawArgs, process.env);
  if (rawArgs.includes('--once')) {
    const input = await Bun.stdin.text();
    const result = await runOnce(dataDir, input);
    console.log(JSON.stringify(result.output));
    process.exitCode = result.exitCode;
    return;
  }
  const positional = stripDataDirFlag(rawArgs);
  if (positional[0] === 'admin') {
    process.exitCode = await runAdminCommand(positional.slice(1), dataDir);
    return;
  }
  let remote: RemoteConfig;
  try {
    remote = remoteConfigFrom(process.env);
  } catch (error) {
    console.error(`factory-server: ${(error as Error).message}`);
    process.exitCode = 2;
    return;
  }
  const state: {
    stopping: boolean;
    opened?: OpenedRuntime;
    listener?: SocketListener;
    http?: HttpListener;
  } = { stopping: false };

  const shutdown = async (signal: string): Promise<void> => {
    if (state.stopping) return;
    state.stopping = true;
    console.log(`factory-server: ${signal}, shutting down`);
    await state.http?.stop();
    await state.listener?.stop();
    state.opened?.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  let opened: OpenedRuntime;
  try {
    opened = openForAdmin(dataDir);
  } catch (error) {
    if (error instanceof WriterHeldError) {
      console.error(
        `factory-server: another factory-server holds ${error.lockFile}`,
      );
      process.exit(1);
    }
    throw error;
  }
  state.opened = opened;

  await opened.runtime.start();
  if (state.stopping) return;
  const listener = startSocketListener({
    runtime: opened.runtime,
    socketPath: join(dataDir, SOCKET_FILE_NAME),
  });
  state.listener = listener;
  console.log(`factory-server: listening on ${listener.socketPath}`);
  if (remote.enabled) {
    state.http = startHttpListener({
      runtime: opened.runtime,
      hostname: remote.hostname,
      port: remote.port,
    });
    console.log(`factory-server: remote listening on ${state.http.url}`);
  }
};

if (import.meta.main) {
  await main();
}
