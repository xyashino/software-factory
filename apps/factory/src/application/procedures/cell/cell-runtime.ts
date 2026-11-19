import type { z } from 'zod';
import type { claimedJobDto } from '../../../contracts/cells.contract';
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
  signal: AbortSignal;
}

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
