import type { PlanId } from '@repo/factory-core/ids';
import { orderCommandSchema } from '@repo/factory-core/order/commands';
import { planCommandSchema } from '@repo/factory-core/plan/commands';
import type { PrState } from '@repo/factory-core/ports/pr-state';
import type { CommandHandler } from './command-handler';
import type { RuntimePorts } from './ports';

/** One pull request state change, as a GitHub delivery reports it. */
export interface PullRequestChange {
  /** The delivery id: the command id of every record it makes, so a redelivery records nothing new. */
  deliveryId: string;
  prUrl: string;
  state: PrState;
}

const FACTORY = { kind: 'factory' } as const;

const commandIdFor = (
  change: PullRequestChange,
  streams: number,
  streamId: string,
): string =>
  streams === 1 ? change.deliveryId : `${change.deliveryId}:${streamId}`;

/**
 * Records a pull request's state on every Work order and Order Plan whose stored `prUrl` is the given
 * one. A stream already at that state is left alone, so a repeated delivery never
 * appends a second `pr_state_changed`. Returns how many streams changed.
 */
export const recordPullRequest = async (
  ports: RuntimePorts,
  handler: CommandHandler,
  change: PullRequestChange,
): Promise<number> => {
  const orders = (await ports.projections.orders()).filter(
    (row) => row.prUrl === change.prUrl,
  );
  const plans = (await ports.projections.plans()).filter(
    (plan) => plan.prUrl === change.prUrl,
  );
  const streams = orders.length + plans.length;
  let recorded = 0;
  for (const row of orders) {
    if (row.prState === change.state) continue;
    await handler.submit({
      orderId: row.orderId,
      commandId: commandIdFor(change, streams, row.orderId),
      command: orderCommandSchema.parse({
        type: 'RecordPrState',
        prUrl: change.prUrl,
        state: change.state,
      }),
      actor: FACTORY,
    });
    recorded += 1;
  }
  for (const plan of plans) {
    if (plan.prState === change.state) continue;
    await handler.submitPlan({
      planId: plan.planId as PlanId,
      commandId: commandIdFor(change, streams, plan.planId),
      command: planCommandSchema.parse({
        type: 'RecordPlanPrState',
        prUrl: change.prUrl,
        state: change.state,
      }),
      actor: FACTORY,
    });
    recorded += 1;
  }
  return recorded;
};
