import { claimJobContract } from '@repo/factory-contracts/cells.contract';
import { nextStep, type NextStep } from '../../../domain/cell/cell-loop';
import {
  type CellRuntime,
  type ClaimedJob,
  reportActivity,
} from './cell-runtime';
import { runJob } from './run-job.procedure';

const CLAIMS_ROUTE = '/api/v1/cells/claims';

export const claimOnce = async (
  runtime: CellRuntime,
  waitMs: number,
): Promise<ClaimedJob | null> =>
  claimJobContract.out[200].parse(
    await runtime.ports.server.call(
      CLAIMS_ROUTE,
      {
        waitMs,
        projectId: runtime.projectId,
        allowedLines: runtime.allowedLines,
        runners: runtime.runners,
      },
      runtime.session.sessionToken,
    ),
  ).job;

export const claimLoop = async (
  runtime: CellRuntime,
  initial: ClaimedJob | null,
): Promise<void> => {
  let next: NextStep<ClaimedJob> = nextStep(initial);
  while (!runtime.signal.aborted) {
    if (next.kind === 'run') {
      next = nextStep(await runJob(runtime, next.job));
    } else {
      await reportActivity(runtime, {
        state: 'idle',
        writes: false,
        since: runtime.ports.clock.now(),
      });
      next = nextStep(await claimOnce(runtime, next.waitMs));
    }
  }
};
