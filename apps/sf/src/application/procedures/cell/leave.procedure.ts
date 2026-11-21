import { leaveCellContract } from '../../../contracts/cells.contract';
import { commandIdOf } from '../../../domain/cell/command-id';
import { Refused } from '../../core/errors';
import {
  type CellRuntime,
  type ClaimedJob,
  sendWithRetry,
} from './cell-runtime';

const LEAVE_ROUTE = '/api/v1/cells/leave';
const NO_JOB_ORDER_ID = 'cell';
const NO_JOB_EPOCH = 0;
const STALE_EPOCH_TYPE = 'stale-lease-epoch';

interface LeaveBody {
  commandId: string;
  epoch: number;
  jobId?: string;
}

const isStaleEpoch = (error: unknown): boolean =>
  error instanceof Refused &&
  typeof error.details === 'object' &&
  error.details !== null &&
  'type' in error.details &&
  error.details.type === STALE_EPOCH_TYPE;

const leaveBodyOf = (cellId: string, job: ClaimedJob | null): LeaveBody =>
  job === null
    ? {
        commandId: commandIdOf({
          cellId,
          orderId: NO_JOB_ORDER_ID,
          epoch: NO_JOB_EPOCH,
          command: 'leave',
        }),
        epoch: NO_JOB_EPOCH,
      }
    : {
        commandId: commandIdOf({
          cellId,
          orderId: job.orderId ?? job.jobId,
          epoch: job.epoch,
          command: 'leave',
        }),
        epoch: job.epoch,
        jobId: job.jobId,
      };

export const leaveCell = async (
  runtime: CellRuntime,
  job: ClaimedJob | null,
): Promise<void> => {
  runtime.drain.left = true;
  try {
    await sendWithRetry(runtime, async () =>
      leaveCellContract.out[200].parse(
        await runtime.ports.server.call(
          LEAVE_ROUTE,
          leaveBodyOf(runtime.session.cellId, job),
          runtime.session.sessionToken,
        ),
      ),
    );
  } catch (error) {
    if (!isStaleEpoch(error)) {
      throw error;
    }
    runtime.drain.superseded = true;
  }
};
