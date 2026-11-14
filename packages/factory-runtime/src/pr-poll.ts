import type { PlanId } from '@repo/factory-core/ids';
import type { CommandHandler } from './command-handler';
import type { RuntimePorts } from './ports';

/**
 * One pass over the delivered Work orders and the Order Plans whose pull request is not yet merged or
 * closed (ROADMAP M4, CORE §12.3). Each state that differs from the stored one becomes a `RecordPrState`
 * (or `RecordPlanPrState` for a plan), with a command id that names the stream and the state, so a
 * repeated pass records nothing new. Returns how many pull requests it asked about.
 */
export const pollPrStates = async (
  ports: RuntimePorts,
  handler: CommandHandler,
): Promise<number> => {
  let asked = 0;
  for (const plan of await ports.projections.plans()) {
    if (!plan.prUrl) continue;
    if (plan.prState === 'merged' || plan.prState === 'closed') continue;
    asked += 1;
    const state = await ports.prState.read(plan.prUrl);
    if (state === plan.prState) continue;
    await handler.submitPlan({
      planId: plan.planId as PlanId,
      commandId: `plan-pr:${plan.planId}:${state}`,
      command: { type: 'RecordPlanPrState', prUrl: plan.prUrl, state },
      actor: { kind: 'factory' },
    });
  }
  for (const row of await ports.projections.orders()) {
    if (!row.prUrl) continue;
    if (row.prState === 'merged' || row.prState === 'closed') continue;
    asked += 1;
    const state = await ports.prState.read(row.prUrl);
    if (state === row.prState) continue;
    await handler.submit({
      orderId: row.orderId,
      commandId: `pr:${row.orderId}:${state}`,
      command: { type: 'RecordPrState', prUrl: row.prUrl, state },
      actor: { kind: 'factory' },
    });
  }
  return asked;
};
