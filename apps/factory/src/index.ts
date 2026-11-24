import { hostname } from 'node:os';
import { buildFactoryPorts } from './bootstrap';
import { createFactoryApp } from './app';
import { cellNameOf } from './cell-name';
import {
  CLI_ENTRY,
  DEFAULT_DATA_DIR,
  FACTORY_DAEMON_PORT,
  FACTORY_LOCAL_DB_PATH,
  IS_COMPILED,
  LOCAL_CELLS_DIR,
  cellWorkerLauncherOf,
} from './config';
import { HQ_TICK_MS } from './hq-link';
import { createLocalEngine } from './local-engine';

const HOST = '127.0.0.1';
const RECONCILE_MS = 1_000;

const ports = buildFactoryPorts();
const app = createFactoryApp({
  ports,
  local: createLocalEngine({ dbPath: FACTORY_LOCAL_DB_PATH }),
  cellLauncher: cellWorkerLauncherOf(IS_COMPILED, CLI_ENTRY),
  cellsLogDir: LOCAL_CELLS_DIR,
  baseName: cellNameOf(hostname()),
});
await app.tick();
const timer = setInterval(() => void app.tick(), HQ_TICK_MS);
const reconcileTimer = setInterval(() => void app.reconcile(), RECONCILE_MS);
const server = Bun.serve({
  hostname: HOST,
  port: FACTORY_DAEMON_PORT,
  fetch: app.fetch,
});

const shutdown = async (): Promise<void> => {
  clearInterval(timer);
  clearInterval(reconcileTimer);
  server.stop(true);
  await app.stop();
  if ((await ports.pidFile.read(DEFAULT_DATA_DIR)) === process.pid) {
    await ports.pidFile.remove(DEFAULT_DATA_DIR);
  }
  process.exit(0);
};

process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
