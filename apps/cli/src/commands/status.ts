import { defineCommand } from 'citty';
import { latestSeq, nextEvents } from '../client/feed';
import {
  createContext,
  flagsOf,
  globalArgs,
  printJson,
  withErrors,
} from '../context';
import { isHiddenByDefault, renderBoard } from '../render/board';

export const statusCommand = defineCommand({
  meta: {
    name: 'status',
    description: 'The board: every open Work order, and recent terminal ones',
  },
  args: {
    ...globalArgs,
    watch: {
      type: 'boolean',
      description:
        'Print the board again on every change, following the event feed',
    },
    all: {
      type: 'boolean',
      description: 'Include terminal Work orders older than seven days',
    },
    frames: {
      type: 'string',
      description:
        'With --watch, stop after this many boards (for scripts and tests)',
    },
  },
  run: ({ args }) =>
    withErrors(async () => {
      const ctx = createContext(flagsOf(args));
      const watch = args.watch === true;
      const limit = watch && args.frames ? Number(args.frames) : 1;
      if (!Number.isInteger(limit) || limit < 1) {
        throw new Error('--frames must be a positive whole number');
      }
      const showAll = args.all === true;

      let cursor = watch ? await latestSeq(ctx.client) : 0;
      for (let frame = 1; ; frame += 1) {
        const board = await ctx.client.call('board', {});
        const rows = showAll
          ? board.orders
          : board.orders.filter((row) => !isHiddenByDefault(row, ctx.now()));
        if (ctx.json) {
          printJson({ orders: rows });
        } else {
          console.log(renderBoard(rows, ctx.paint, ctx.now()));
        }
        if (frame >= limit) return;
        const next = await nextEvents(ctx.client, cursor);
        cursor = next.cursor;
        if (!ctx.json) console.log('');
      }
    }),
});
