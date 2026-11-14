import { defineCommand } from 'citty';
import type { OrderId } from '@repo/factory-core/ids';
import {
  createContext,
  flagsOf,
  globalArgs,
  printJson,
  withErrors,
} from '../context';
import { renderOrder } from '../render/order';

export const showCommand = defineCommand({
  meta: {
    name: 'show',
    description: 'A Work order: state, holder, Cycles, open question, Andon',
  },
  args: {
    ...globalArgs,
    order: {
      type: 'positional',
      required: true,
      description: 'The Work order id',
    },
  },
  run: ({ args }) =>
    withErrors(async () => {
      const ctx = createContext(flagsOf(args));
      const detail = await ctx.client.call('orderDetail', {
        orderId: String(args.order) as OrderId,
      });
      if (ctx.json) {
        printJson(detail);
        return;
      }
      console.log(renderOrder(detail, ctx.paint, ctx.now()));
    }),
});
