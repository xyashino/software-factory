import { createHash } from 'node:crypto';

export interface CommandIdInput {
  cellId: string;
  orderId: string;
  epoch: number;
  command: string;
}

const FIELD_SEPARATOR = '|';

export const commandIdOf = (input: CommandIdInput): string =>
  createHash('sha256')
    .update(
      [input.cellId, input.orderId, input.epoch, input.command].join(
        FIELD_SEPARATOR,
      ),
    )
    .digest('hex');
