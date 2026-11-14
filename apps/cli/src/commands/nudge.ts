import { defineCommand } from 'citty';
import type { OrderId } from '@repo/factory-core/ids';
import {
  createContext,
  flagsOf,
  globalArgs,
  printJson,
  withErrors,
} from '../context';

export const nudgeCommand = defineCommand({
  meta: {
    name: 'nudge',
    description: "Type into a live Operator's pane",
  },
  args: {
    ...globalArgs,
    order: {
      type: 'positional',
      required: true,
      description: 'The Work order id',
    },
    text: { type: 'positional', required: true, description: 'What to type' },
  },
  run: ({ args }) =>
    withErrors(async () => {
      const ctx = createContext(flagsOf(args));
      const orderId = String(args.order) as OrderId;
      const result = await ctx.client.call('nudge', {
        orderId,
        commandId: ctx.commandId(),
        text: String(args.text),
      });
      if (ctx.json) printJson(result);
      else console.log(`nudged ${orderId}`);
    }),
});
