import { observeDrain } from '../../../cell/drain-signal';
import { claimJobContract } from '../../../contracts/cells.contract';
import { nextStep, type NextStep } from '../../../domain/cell/cell-loop';
import { type CellRuntime, type ClaimedJob } from './cell-runtime';
import { leaveCell } from './leave.procedure';
import { runJob } from './run-job.procedure';

const CLAIMS_ROUTE = '/api/v1/cells/claims';

export const claimOnce = async (
  runtime: CellRuntime,
  waitMs: number,
): Promise<ClaimedJob | null> => {
  const reply = claimJobContract.out[200].parse(
    await runtime.ports.server.call(
      CLAIMS_ROUTE,
      { waitMs },
      runtime.session.sessionToken,
    ),
  );
  observeDrain(runtime.drain, reply.signals);
  return reply.job;
};

export const claimLoop = async (
  runtime: CellRuntime,
  initial: ClaimedJob | null,
): Promise<void> => {
  let next: NextStep<ClaimedJob> = nextStep(initial);
  while (!runtime.signal.aborted && !runtime.drain.left) {
    if (runtime.drain.draining) {
      await leaveCell(runtime, next.kind === 'run' ? next.job : null);
      return;
    }
    next =
      next.kind === 'run'
        ? nextStep(await runJob(runtime, next.job))
        : nextStep(await claimOnce(runtime, next.waitMs));
  }
};
