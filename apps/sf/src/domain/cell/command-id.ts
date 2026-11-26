import { createHash } from 'node:crypto';

export interface CommandIdInput {
  cellId: string;
  jobId: string;
  orderId: string;
  epoch: number;
  command: string;
}

const FIELD_SEPARATOR = '|';

// A retried order gets a new job at the same epoch; without jobId its commands would reuse the old job's ids and HQ would reject them.
export const commandIdOf = (input: CommandIdInput): string =>
  createHash('sha256')
    .update(
      [
        input.cellId,
        input.jobId,
        input.orderId,
        input.epoch,
        input.command,
      ].join(FIELD_SEPARATOR),
    )
    .digest('hex');
