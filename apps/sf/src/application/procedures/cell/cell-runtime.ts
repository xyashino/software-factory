import type { z } from 'zod';
import type { claimedJobDto } from '@repo/factory-contracts/cells.contract';
import type { DrainState } from '../../../cell/drain-signal';
import { Unreachable } from '../../core/errors';
import type { Ports } from '../../core/procedure';
import type { CellSession } from '../../ports/cell-state.port';

const RETRY_DELAYS_MS = [200, 400, 800];

export type ClaimedJob = z.infer<typeof claimedJobDto>;

export interface CellRuntime {
  ports: Ports;
  session: CellSession;
  projectId: string;
  repoRoot: string;
  logPath: string;
  signal: AbortSignal;
  drain: DrainState;
  daemonCellId?: string;
}

export interface ActivityReport {
  state: 'idle' | 'running';
  orderId?: string;
  stationId?: string;
  writes?: boolean;
  since: number;
}

// Best-effort: a missing daemon must not fail a job; the daemon's parent-gone watch stops this Cell.
export const reportActivity = async (
  runtime: CellRuntime,
  report: ActivityReport,
): Promise<void> => {
  if (runtime.daemonCellId === undefined) {
    return;
  }
  try {
    await runtime.ports.factoryDaemon.post(
      `/cells/${encodeURIComponent(runtime.daemonCellId)}/activity`,
      report,
    );
  } catch {
    // Reporting is optional: the Cell keeps working without the daemon.
  }
};

export const sendWithRetry = async <T>(
  runtime: CellRuntime,
  call: () => Promise<T>,
): Promise<T> => {
  for (const delayMs of RETRY_DELAYS_MS) {
    try {
      return await call();
    } catch (error) {
      if (!(error instanceof Unreachable)) {
        throw error;
      }
      await runtime.ports.clock.sleep(delayMs);
    }
  }
  return call();
};
