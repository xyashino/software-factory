import { z } from 'zod';
import { ArgumentError } from '../../core/errors';
import { define } from '../../core/procedure';
import { readSecret } from '../../core/repo-access';

export const TRANSITION_ACTIONS = ['resume', 'reopen', 'cancel'] as const;

const TransitionSchema = z
  .object({
    orderId: z.string().trim().min(1),
    action: z.enum(TRANSITION_ACTIONS),
    yes: z.boolean(),
  })
  .strict();

const TransitionReplySchema = z.object({
  order: z.object({ orderId: z.string(), state: z.string() }),
});

export interface TransitionResult {
  order: { orderId: string; state: string };
}

export const transitionWorkOrder = define({ kind: 'operator' })(
  TransitionSchema,
)<TransitionResult>(async (input, ctx) => {
  if (input.action === 'cancel' && !input.yes) {
    throw new ArgumentError(
      `cancel would cancel order ${input.orderId}. Re-run with --yes`,
    );
  }
  const secret = await readSecret(ctx);
  return TransitionReplySchema.parse(
    await ctx.hq.call(
      `/api/v1/work-orders/${encodeURIComponent(input.orderId)}/transitions`,
      { action: input.action },
      secret,
    ),
  );
});
