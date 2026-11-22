import { z } from 'zod';
import {
  PRIORITIES,
  WORK_ORDER_STATES,
} from '@repo/factory-contracts/enums/orders';
import { ArgumentError } from '../../core/errors';
import { define } from '../../core/procedure';
import { readSecret } from '../../core/repo-access';

const ACTIONS_ROUTE = '/api/v1/queue/actions';

const ActionSchema = z.enum([
  'pause',
  'unpause',
  'reset',
  'cancel',
  'reprioritise',
]);

const ActionsSchema = z
  .object({
    action: ActionSchema,
    orderIds: z.array(z.string().trim().min(1)).min(1).max(200),
    priority: z.enum(PRIORITIES).optional(),
    yes: z.boolean(),
  })
  .strict();

const ActionsReplySchema = z.object({
  orders: z.array(
    z.object({
      orderId: z.string(),
      state: z.enum(WORK_ORDER_STATES),
      priority: z.enum(PRIORITIES),
    }),
  ),
});

const SERVER_ACTION = {
  pause: 'pause',
  unpause: 'unpause',
  reset: 'reset_to_scratch',
  cancel: 'cancel',
  reprioritise: 'reprioritise',
} as const;

export type QueueAction = z.infer<typeof ActionSchema>;

export interface QueueActionResult {
  orders: z.infer<typeof ActionsReplySchema>['orders'];
}

export const runQueueAction = define({ kind: 'supervisor' })(
  ActionsSchema,
)<QueueActionResult>(async (input, ctx) => {
  if (input.action === 'reprioritise' && input.priority === undefined) {
    throw new ArgumentError('reprioritise requires --priority high|medium|low');
  }
  if (input.action === 'cancel' && !input.yes) {
    throw new ArgumentError(
      `cancel would cancel ${input.orderIds.length} order(s): ${input.orderIds.join(', ')}. Re-run with --yes`,
    );
  }
  const secret = await readSecret(ctx);
  const body =
    input.action === 'reprioritise'
      ? {
          action: SERVER_ACTION.reprioritise,
          orderIds: input.orderIds,
          priority: input.priority,
        }
      : { action: SERVER_ACTION[input.action], orderIds: input.orderIds };
  return ActionsReplySchema.parse(
    await ctx.server.call(ACTIONS_ROUTE, body, secret),
  );
});
