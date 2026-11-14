import { defineCommand } from 'citty';
import type { OrderId } from '@repo/factory-core/ids';
import { latestSeq, nextEvents } from '../client/feed';
import {
  createContext,
  flagsOf,
  globalArgs,
  printJson,
  withErrors,
} from '../context';
import { renderEventLine, renderTraveler } from '../render/log-view';

export const logCommand = defineCommand({
  meta: {
    name: 'log',
    description: 'The Traveler of a Work order, optionally followed',
  },
  args: {
    ...globalArgs,
    order: {
      type: 'positional',
      required: true,
      description: 'The Work order id',
    },
    follow: {
      type: 'boolean',
      alias: 'f',
      description:
        'Keep printing the events that arrive after the last one shown',
    },
  },
  run: ({ args }) =>
    withErrors(async () => {
      const ctx = createContext(flagsOf(args));
      const orderId = String(args.order) as OrderId;
      const detail = await ctx.client.call('orderDetail', { orderId });
      if (ctx.json) {
        printJson(detail.events);
      } else if (detail.events.length > 0) {
        console.log(renderTraveler(detail.events, ctx.paint));
      }
      if (args.follow !== true) return;

      let cursor = await latestSeq(ctx.client);
      for (;;) {
        const next = await nextEvents(ctx.client, cursor);
        cursor = next.cursor;
        for (const stored of next.events) {
          if (stored.orderId !== orderId) continue;
          console.log(
            ctx.json
              ? JSON.stringify(stored)
              : renderEventLine(stored, ctx.paint),
          );
        }
      }
    }),
});
