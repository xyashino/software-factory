import { hostname } from 'node:os';
import { closeCellWorkspace } from '../adapters/runners/herdr';
import { buildContext } from '../bootstrap/context';
import {
  CELL_ID_ENV,
  CELL_LINES_ENV,
  CLI_ENTRY,
  DEFAULT_DATA_DIR,
  FACTORY_DAEMON_PORT,
  FACTORY_DAEMON_URL,
  FACTORY_PID_ENV,
  IS_COMPILED,
  LOCAL_CELLS_DIR,
  cellWorkerLauncherOf,
} from '../config';
import { cellNameOf } from '../domain/cell/cell-name';
import type { HqState } from '../domain/factory/hq-state';
import { HQ_TICK_MS, createHqLink } from './hq-link';
import { RELAY_PATH, createRelay } from './relay';
import { createFactoryRoutes } from './routes';
import { createScaler } from './scaler';
import { createSupervisor } from './supervisor';

const HOST = '127.0.0.1';
const RECONCILE_MS = 1_000;
const RELAY_URL = `${FACTORY_DAEMON_URL}${RELAY_PATH}`;
const cellLauncher = cellWorkerLauncherOf(IS_COMPILED, CLI_ENTRY);

const gateOf = (state: HqState): string | null => {
  switch (state.kind) {
    case 'ok':
      return null;
    case 'not_connected':
      return 'factory not connected: run "sf factory connect"';
    case 'unreachable':
      return 'HQ unreachable: no Cell starts until HQ answers';
    case 'rejected':
      return 'HQ rejected the credential: run "sf factory connect"';
  }
};

const workerEnvOf = (
  localToken: string,
  cellId: string,
  lines: readonly string[] | undefined,
): Record<string, string> => ({
  [FACTORY_PID_ENV]: String(process.pid),
  // The daemon inherits the legacy names; blank them so a Cell never sees the HQ URL or credential.
  FACTORY_URL: '',
  FACTORY_TOKEN: '',
  HQ_URL: RELAY_URL,
  HQ_TOKEN: localToken,
  [CELL_ID_ENV]: cellId,
  ...(lines === undefined ? {} : { [CELL_LINES_ENV]: lines.join(',') }),
});

const ports = buildContext();
const supervisor = createSupervisor(ports, LOCAL_CELLS_DIR);
const credential = ports.factoryCredential.read();
const scaler = createScaler({
  supervisor,
  now: () => ports.clock.now(),
  baseName: cellNameOf(hostname()),
  start: async ({ cellId, name, lines }) => ({
    args: [...cellLauncher, 'cell', 'start', '--name', name],
    env: workerEnvOf(relay.issue(cellId), cellId, lines),
  }),
  gate: () => gateOf(hq.state()),
  // HQ failure is not reported: the HQ reaper requeues the Cell's job after its lease expires.
  onStopped: async (cell) => {
    // Herdr may be down; the workspace is reused by name on the next start, so a miss is harmless.
    await closeCellWorkspace(ports.process, cell.name, process.cwd()).catch(
      () => undefined,
    );
    const current = ports.factoryCredential.read();
    if (current === null) {
      return;
    }
    await ports.hqLink.goneCell({
      url: current.url,
      sessionToken: current.sessionToken,
      cellId: cell.cellId,
    });
  },
});
const hq = createHqLink({
  credential,
  hqLink: ports.hqLink,
  clock: ports.clock,
  projects: () => supervisor.projects(),
  killAll: () => scaler.stopAll(),
});
await hq.tick();
const timer = setInterval(() => void hq.tick(), HQ_TICK_MS);
const relay = createRelay({
  credential: () => ports.factoryCredential.read(),
  alive: (cellId) => supervisor.has(cellId),
  kill: (cellId) => supervisor.kill(cellId),
});
const reconcileTimer = setInterval(() => void scaler.reconcile(), RECONCILE_MS);
const server = Bun.serve({
  hostname: HOST,
  port: FACTORY_DAEMON_PORT,
  fetch: createFactoryRoutes({
    ports,
    supervisor,
    scaler,
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
  clearInterval(reconcileTimer);
  server.stop(true);
  await supervisor.killAll();
  if ((await ports.factoryPidFile.read(DEFAULT_DATA_DIR)) === process.pid) {
    await ports.factoryPidFile.remove(DEFAULT_DATA_DIR);
  }
  process.exit(0);
};

process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
