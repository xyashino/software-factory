import type { z } from 'zod';
import type { claimedJobDto } from '@repo/hq-contracts/cells.contract';
import { Unreachable } from '../../core/errors';
import type { Ports } from '../../core/procedure';

const RETRY_DELAYS_MS = [200, 400, 800];

export type ClaimedJob = z.infer<typeof claimedJobDto>;

export interface CellSession {
  cellId: string;
  sessionToken: string;
}

export interface CellRuntime {
  ports: Ports;
  session: CellSession;
  projectId: string;
  allowedLines: readonly string[];
  runners: readonly string[];
  repoRoot: string;
  logPath: string;
  signal: AbortSignal;
}

export interface ActivityReport {
  state: 'idle' | 'running';
  writes: boolean;
  since: number;
}

// Best-effort: a missing daemon must not fail a job; the daemon keeps the Cell either way.
export const reportActivity = async (
  runtime: CellRuntime,
  report: ActivityReport,
): Promise<void> => {
  try {
    await runtime.ports.factory.post(
      `/cells/${encodeURIComponent(runtime.session.cellId)}/activity`,
      report,
    );
  } catch {
    // The Cell keeps working without activity reports.
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
