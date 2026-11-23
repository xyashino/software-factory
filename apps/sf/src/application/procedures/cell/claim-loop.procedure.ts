import { claimJobContract } from '@repo/factory-contracts/cells.contract';
import { nextStep, type NextStep } from '../../../domain/cell/cell-loop';
import { type CellRuntime, type ClaimedJob } from './cell-runtime';
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
    next =
      next.kind === 'run'
        ? nextStep(await runJob(runtime, next.job))
        : nextStep(await claimOnce(runtime, next.waitMs));
  }
};
