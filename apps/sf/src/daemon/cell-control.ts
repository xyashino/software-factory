import { hostname } from 'node:os';
import {
  CELL_LINES_ENV,
  CLI_ENTRY,
  FACTORY_CELL_ID_ENV,
  FACTORY_DAEMON_URL,
  FACTORY_PID_ENV,
  IS_COMPILED,
  JOIN_TOKEN_ENV,
  cellWorkerLauncherOf,
} from '../config';
import { cellNameOf } from '../domain/cell/cell-name';
import type { Ports } from '../application/core/procedure';
import { RELAY_PATH, type Relay } from './relay';
import type { CellSpec } from './scale';
import type { CellRecord, Supervisor } from './supervisor';

const RELAY_URL = `${FACTORY_DAEMON_URL}${RELAY_PATH}`;
const cellLauncher = cellWorkerLauncherOf(IS_COMPILED, CLI_ENTRY);

export interface CellControlDeps {
  ports: Ports;
  supervisor: Supervisor;
  relay: Relay;
}

export interface CellControl {
  spawn(spec: CellSpec): Promise<CellRecord>;
  stop(cellId: string): Promise<void>;
}

const workerEnvOf = (
  cellId: string,
  localToken: string,
  lines: readonly string[] | undefined,
): Record<string, string> => ({
  [FACTORY_PID_ENV]: String(process.pid),
  [FACTORY_CELL_ID_ENV]: cellId,
  FACTORY_URL: RELAY_URL,
  FACTORY_TOKEN: localToken,
  // Blank, so a join token inherited from the daemon's env never reaches the Cell.
  [JOIN_TOKEN_ENV]: '',
  ...(lines === undefined ? {} : { [CELL_LINES_ENV]: lines.join(',') }),
});

// HQ failure is not reported: the HQ reaper deletes the Cell after its lease expires.
const goneInHq = async (
  deps: CellControlDeps,
  hqCellId: string,
): Promise<void> => {
  const credential = deps.ports.factoryCredential.read();
  if (credential === null) {
    return;
  }
  try {
    await deps.ports.hq.goneCell({
      url: credential.url,
      sessionToken: credential.sessionToken,
      cellId: hqCellId,
    });
  } catch {
    // The reaper removes the Cell once its lease expires.
  }
};

export const createCellControl = (deps: CellControlDeps): CellControl => ({
  spawn: (spec) =>
    deps.supervisor.spawn({
      repoRoot: spec.repoRoot,
      name: undefined,
      baseName: cellNameOf(hostname()),
      start: async (name, cellId) => ({
        args: [...cellLauncher, 'cell', 'start', '--name', name],
        env: workerEnvOf(cellId, deps.relay.issue(cellId), spec.lines),
      }),
    }),
  stop: async (cellId) => {
    await deps.supervisor.kill(cellId);
    const hqCellId = deps.relay.hqCellIdOf(cellId);
    if (hqCellId !== null) {
      await goneInHq(deps, hqCellId);
    }
  },
});
