import { buildContext } from '../bootstrap/context';
import {
  DEFAULT_DATA_DIR,
  FACTORY_DAEMON_PORT,
  LOCAL_CELLS_DIR,
} from '../config';
import { createFactoryRoutes } from './routes';
import { createSupervisor } from './supervisor';

const HOST = '127.0.0.1';

const ports = buildContext();
const supervisor = createSupervisor(ports, LOCAL_CELLS_DIR);
const server = Bun.serve({
  hostname: HOST,
  port: FACTORY_DAEMON_PORT,
  fetch: createFactoryRoutes({ ports, supervisor }),
});

const shutdown = async (): Promise<void> => {
  server.stop(true);
  await supervisor.killAll();
  if ((await ports.factoryPidFile.read(DEFAULT_DATA_DIR)) === process.pid) {
    await ports.factoryPidFile.remove(DEFAULT_DATA_DIR);
  }
  process.exit(0);
};

process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
