import { defineCommand } from 'citty';
import type { OrderId, StationId } from '@repo/factory-core/ids';
import { putNote } from '../client/blobs';
import {
  createContext,
  flagsOf,
  globalArgs,
  printJson,
  withErrors,
} from '../context';

export const reopenCommand = defineCommand({
  meta: {
    name: 'reopen',
    description: 'Send a delivered, unmerged Work order back for rework',
  },
  args: {
    ...globalArgs,
    order: {
      type: 'positional',
      required: true,
      description: 'The Work order id',
    },
    from: {
      type: 'string',
      required: true,
      description: 'The station to rework from',
    },
    note: { type: 'string', description: 'A note the Operator reads' },
  },
  run: ({ args }) =>
    withErrors(async () => {
      const ctx = createContext(flagsOf(args));
      const orderId = String(args.order) as OrderId;
      const noteBlob =
        args.note === undefined
          ? undefined
          : await putNote(ctx.client, String(args.note));
      const result = await ctx.client.call('reopen', {
        orderId,
        commandId: ctx.commandId(),
        stationId: String(args.from) as StationId,
        ...(noteBlob !== undefined ? { noteBlob } : {}),
      });
      if (ctx.json) printJson(result);
      else console.log(`reopened ${orderId} from ${String(args.from)}`);
    }),
});
