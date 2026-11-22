import { buildContext } from '../bootstrap/context';
import {
  DEFAULT_DATA_DIR,
  FACTORY_DAEMON_PORT,
  LOCAL_CELLS_DIR,
} from '../config';
import { createCellControl } from './cell-control';
import { HQ_TICK_MS, createHqLink, hqGateOf } from './hq-link';
import { createRelay } from './relay';
import { createScale } from './scale';
import { createFactoryRoutes } from './routes';
import { createSupervisor } from './supervisor';

const HOST = '127.0.0.1';

const ports = buildContext();
const supervisor = createSupervisor(ports, LOCAL_CELLS_DIR);
const credential = ports.factoryCredential.read();
const relay = createRelay({
  credential: () => ports.factoryCredential.read(),
  alive: (cellId) => supervisor.has(cellId),
  kill: (cellId) => supervisor.kill(cellId),
});
const cells = createCellControl({ ports, supervisor, relay });
const scale = createScale({
  alive: (cellId) => supervisor.has(cellId),
  clock: ports.clock,
  gate: () => hqGateOf(hq.state()),
  spawn: cells.spawn,
  stop: cells.stop,
  exists: (path) => ports.fs.exists(path),
  lose: cells.lose,
});
const hq = createHqLink({
  credential,
  hq: ports.hq,
  clock: ports.clock,
  killAll: () => scale.stopAll(),
});
await hq.tick();
const timer = setInterval(() => {
  void hq.tick();
  void scale.tick();
}, HQ_TICK_MS);
const server = Bun.serve({
  hostname: HOST,
  port: FACTORY_DAEMON_PORT,
  fetch: createFactoryRoutes({
    ports,
    supervisor,
    scale,
    hq,
    relay,
    identity:
      credential === null
        ? null
        : { url: credential.url, factoryId: credential.factoryId },
  }),
});

const shutdown = async (): Promise<void> => {
  clearInterval(timer);
  server.stop(true);
  await supervisor.killAll();
  if ((await ports.factoryPidFile.read(DEFAULT_DATA_DIR)) === process.pid) {
    await ports.factoryPidFile.remove(DEFAULT_DATA_DIR);
  }
  process.exit(0);
};

process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
