import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  openRuntime,
  WriterHeldError,
  type OpenedRuntime,
} from '@repo/factory-runtime/open-runtime';
import { startSocketListener, type SocketListener } from './socket/listener';
import { usage } from './usage';

/** The socket inside the data directory (PROTOCOL §2). */
export const SOCKET_FILE_NAME = 'factory.sock';

/** The data directory: `$FACTORY_DATA_DIR`, else `~/.local/share/factory` (STORAGE §1). */
export const dataDirFromEnv = (env: NodeJS.ProcessEnv): string =>
  env.FACTORY_DATA_DIR ?? join(homedir(), '.local', 'share', 'factory');

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
  const dataDir = dataDirFromEnv(process.env);
  const state: {
    stopping: boolean;
    opened?: OpenedRuntime;
    listener?: SocketListener;
  } = { stopping: false };

  const shutdown = async (signal: string): Promise<void> => {
    if (state.stopping) return;
    state.stopping = true;
    console.log(`factory-server: ${signal}, shutting down`);
    await state.listener?.stop();
    state.opened?.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  let opened: OpenedRuntime;
  try {
    opened = openRuntime({ dataDir });
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
};

if (import.meta.main) {
  await main();
}
