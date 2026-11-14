import { defineCommand } from 'citty';
import type { OrderId } from '@repo/factory-core/ids';
import {
  createContext,
  flagsOf,
  globalArgs,
  printJson,
  withErrors,
} from '../context';

const LEVELS = ['high', 'medium', 'low'] as const;

export const prioCommand = defineCommand({
  meta: {
    name: 'prio',
    description: 'Set the priority of a Work order',
  },
  args: {
    ...globalArgs,
    order: {
      type: 'positional',
      required: true,
      description: 'The Work order id',
    },
    level: {
      type: 'positional',
      required: true,
      description: 'high, medium or low',
    },
  },
  run: ({ args }) =>
    withErrors(async () => {
      const level = String(args.level);
      if (!(LEVELS as readonly string[]).includes(level)) {
        throw new Error(`the priority must be one of: ${LEVELS.join(', ')}`);
      }
      const ctx = createContext(flagsOf(args));
      const orderId = String(args.order) as OrderId;
      const result = await ctx.client.call('reprioritise', {
        orderId,
        commandId: ctx.commandId(),
        priority: level as (typeof LEVELS)[number],
      });
      if (ctx.json) printJson(result);
      else console.log(`${orderId} priority ${level}`);
    }),
});
