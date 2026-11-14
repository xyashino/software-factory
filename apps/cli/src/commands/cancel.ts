import { defineCommand } from 'citty';
import type { OrderId } from '@repo/factory-core/ids';
import {
  createContext,
  flagsOf,
  globalArgs,
  printJson,
  withErrors,
} from '../context';

/** The reason recorded when the Supervisor gives none. The command schema requires one. */
export const DEFAULT_CANCEL_REASON = 'cancelled by the Supervisor';

export const cancelCommand = defineCommand({
  meta: {
    name: 'cancel',
    description: 'Cancel a Work order',
  },
  args: {
    ...globalArgs,
    order: {
      type: 'positional',
      required: true,
      description: 'The Work order id',
    },
    reason: { type: 'string', description: 'Why it is cancelled' },
  },
  run: ({ args }) =>
    withErrors(async () => {
      const ctx = createContext(flagsOf(args));
      const orderId = String(args.order) as OrderId;
      const result = await ctx.client.call('cancel', {
        orderId,
        commandId: ctx.commandId(),
        reason:
          args.reason === undefined
            ? DEFAULT_CANCEL_REASON
            : String(args.reason),
      });
      if (ctx.json) printJson(result);
      else console.log(`cancelled ${orderId}`);
    }),
});
