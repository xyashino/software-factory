import { defineCommand } from 'citty';
import type { OrderId } from '@repo/factory-core/ids';
import {
  createContext,
  flagsOf,
  globalArgs,
  printJson,
  withErrors,
} from '../context';
import { openQuestionOf } from '../render/order';

export const answerCommand = defineCommand({
  meta: {
    name: 'answer',
    description:
      'Answer the open (or abandoned, unanswered) question of a Work order',
  },
  args: {
    ...globalArgs,
    order: {
      type: 'positional',
      required: true,
      description: 'The Work order id',
    },
    text: { type: 'positional', required: true, description: 'The answer' },
  },
  run: ({ args }) =>
    withErrors(async () => {
      const ctx = createContext(flagsOf(args));
      const orderId = String(args.order) as OrderId;
      const detail = await ctx.client.call('orderDetail', { orderId });
      const question = openQuestionOf(detail.events);
      if (!question) {
        throw new Error(`no open question on ${orderId}`);
      }
      const result = await ctx.client.call('answer', {
        orderId,
        commandId: ctx.commandId(),
        questionId: question.questionId,
        text: String(args.text),
      });
      if (ctx.json) printJson(result);
      else console.log(`answered ${orderId}`);
    }),
});
