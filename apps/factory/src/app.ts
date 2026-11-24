import type {
  FactoryCredential,
  HqState,
} from '@repo/factory-contracts/status.contract';
import {
  CELL_ID_ENV,
  CELL_LINES_ENV,
  FACTORY_DAEMON_URL,
  FACTORY_PID_ENV,
} from './config';
import { createHqLink } from './hq-link';
import type { LocalEngine } from './local-engine';
import { createQueueImport } from './queue-import';
import { RELAY_PATH, createRelay } from './relay';
import { createFactoryRoutes } from './routes';
import { createScaler } from './scaler';
import { createSupervisor } from './supervisor';
import type { FactoryPorts } from './ports';

const RELAY_URL = `${FACTORY_DAEMON_URL}${RELAY_PATH}`;

export interface FactoryAppDeps {
  ports: FactoryPorts;
  local: LocalEngine;
  cellLauncher: readonly string[];
  cellsLogDir: string;
  baseName: string;
}

export interface FactoryApp {
  fetch(request: Request): Promise<Response>;
  tick(): Promise<void>;
  reconcile(): Promise<void>;
  stop(): Promise<void>;
}

const gateOf = (state: HqState): string | null => {
  switch (state.kind) {
    case 'ok':
    case 'not_connected':
      return null;
    case 'unreachable':
      return 'HQ unreachable: no Cell starts until HQ answers';
    case 'rejected':
      return 'HQ rejected the credential: run "sf factory connect"';
  }
};

const workerEnvOf = (
  relayToken: string,
  cellId: string,
  lines: readonly string[] | undefined,
): Record<string, string> => ({
  [FACTORY_PID_ENV]: String(process.pid),
  // The daemon inherits the legacy names; blank them so a Cell never sees the HQ URL or credential.
  FACTORY_URL: '',
  FACTORY_TOKEN: '',
  HQ_URL: RELAY_URL,
  HQ_TOKEN: relayToken,
  [CELL_ID_ENV]: cellId,
  ...(lines === undefined ? {} : { [CELL_LINES_ENV]: lines.join(',') }),
});

export const createFactoryApp = (deps: FactoryAppDeps): FactoryApp => {
  const { ports, local } = deps;
  const credential: FactoryCredential | null = ports.credentials.read();
  const supervisor = createSupervisor(ports, deps.cellsLogDir);
  const relay = createRelay({
    credential: () => ports.credentials.read(),
    alive: (cellId) => supervisor.has(cellId),
    kill: (cellId) => supervisor.kill(cellId),
    local,
  });
  const scaler = createScaler({
    supervisor,
    now: () => ports.clock.now(),
    baseName: deps.baseName,
    start: async ({ cellId, name, lines }) => ({
      args: [...deps.cellLauncher, 'cell', 'start', '--name', name],
      env: workerEnvOf(relay.issue(cellId), cellId, lines),
    }),
    gate: () => gateOf(hq.state()),
    // HQ failure is not reported: the HQ reaper requeues the Cell's job after its lease expires.
    onStopped: async (cellId) => {
      const current = ports.credentials.read();
      if (current === null) {
        await local.goneCell(cellId);
        return;
      }
      await ports.hqLink.goneCell({
        url: current.url,
        sessionToken: current.sessionToken,
        cellId,
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
  const importQueue = createQueueImport({
    repoConfig: ports.repoConfig,
    todoFiles: ports.todoFiles,
    credentials: ports.credentials,
    hqLink: ports.hqLink,
    hq,
    local,
  });
  const fetch = createFactoryRoutes({
    repoConfig: ports.repoConfig,
    supervisor,
    scaler,
    hq,
    relay,
    local,
    connected: () => ports.credentials.read() !== null,
    identity:
      credential === null
        ? null
        : { url: credential.url, factoryId: credential.factoryId },
    importQueue,
  });
  return {
    fetch,
    tick: () => hq.tick(),
    reconcile: () => scaler.reconcile(),
    stop: () => supervisor.killAll(),
  };
};
