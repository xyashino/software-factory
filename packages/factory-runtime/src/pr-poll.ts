import type { PlanId } from '@repo/factory-core/ids';
import type { PrState } from '@repo/factory-core/ports/pr-state';
import type { CommandHandler } from './command-handler';
import type { RuntimePorts } from './ports';

/** A row with a pull request that is not yet merged or closed: the only ones the poll asks about. */
interface OpenPr {
  prUrl: string;
  prState: PrState | null;
}

const openPrs = <T extends { prUrl: string | null; prState: PrState | null }>(
  rows: readonly T[],
): (T & OpenPr)[] =>
  rows.flatMap((row) =>
    row.prUrl && row.prState !== 'merged' && row.prState !== 'closed'
      ? [{ ...row, prUrl: row.prUrl }]
      : [],
  );

/**
 * One pass over the delivered Work orders and the Order Plans whose pull request is not yet merged or
 * closed (ROADMAP M4, CORE §12.3). The states of all of them are read in one batch, then each state
 * that differs from the stored one becomes a `RecordPrState` (or `RecordPlanPrState` for a plan), with
 * a command id that names the stream and the state, so a repeated pass records nothing new. A pull
 * request whose state could not be read is skipped until the next pass. Returns how many pull requests
 * it asked about.
 */
export const pollPrStates = async (
  ports: RuntimePorts,
  handler: CommandHandler,
): Promise<number> => {
  const plans = openPrs(await ports.projections.plans());
  const orders = openPrs(await ports.projections.orders());
  const asked = plans.length + orders.length;
  if (asked === 0) return 0;

  const states = await ports.prState.readMany([
    ...new Set([...plans, ...orders].map((row) => row.prUrl)),
  ]);

  for (const plan of plans) {
    const state = states.get(plan.prUrl);
    if (state === undefined || state === plan.prState) continue;
    await handler.submitPlan({
      planId: plan.planId as PlanId,
      commandId: `plan-pr:${plan.planId}:${state}`,
      command: { type: 'RecordPlanPrState', prUrl: plan.prUrl, state },
      actor: { kind: 'factory' },
    });
  }
  for (const row of orders) {
    const state = states.get(row.prUrl);
    if (state === undefined || state === row.prState) continue;
    await handler.submit({
      orderId: row.orderId,
      commandId: `pr:${row.orderId}:${state}`,
      command: { type: 'RecordPrState', prUrl: row.prUrl, state },
      actor: { kind: 'factory' },
    });
  }
  return asked;
};
