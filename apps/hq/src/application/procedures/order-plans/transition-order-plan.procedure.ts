import { transitionOrderPlanContract } from '@repo/hq-contracts/order-plans.contract';
import { nextPlanState } from '../../../domain/orders/order-state';
import { Conflict } from '../../core/error-handling';
import { scopedProcedure } from '../../core/procedure';
import {
  flushTransitions,
  insertPlanBranchJob,
  orderTransition,
  publishCommitted,
  requirePlan,
  requireProject,
  resetChildrenToScratch,
  updateOrderPlan,
  type Actor,
  type PlanResetOutcome,
  type TransitionLog,
} from '../../orders/order-writes';
import { toOrderPlanDto } from '../../orders/order-views';

export const transitionOrderPlanProcedure = scopedProcedure([
  'supervisor:write',
])(transitionOrderPlanContract)(async (input, ctx) => {
  const { action } = input.body;
  const now = ctx.clock.now();
  const actor: Actor = { kind: 'supervisor', id: ctx.principal.tokenId };

  const { row, outcome, records } = await ctx.storage.write(async (tx) => {
    const plan = await requirePlan(tx, input.params.id);
    const next = nextPlanState(plan.state, action);
    if (next === null)
      throw new Conflict(`Order plan cannot ${action} from ${plan.state}`);
    const row = await updateOrderPlan(tx, plan, next, now);
    const log: TransitionLog = [
      orderTransition({
        projectId: plan.projectId,
        entityType: 'order_plan',
        entityId: plan.planId,
        fromState: plan.state,
        toState: next,
        actor,
        at: now,
      }),
    ];
    let outcome: PlanResetOutcome = { reset: [], skipped: [] };
    if (action === 'reset')
      outcome = await resetChildrenToScratch(tx, row, actor, now, log);
    if (next === 'branching')
      await insertPlanBranchJob(
        tx,
        row,
        (await requireProject(tx, plan.projectId)).repoUrl,
        now,
        action === 'reset',
      );
    return { row, outcome, records: await flushTransitions(tx, log) };
  });

  publishCommitted(ctx, records);
  return {
    code: 200 as const,
    plan: toOrderPlanDto(row),
    reset: outcome.reset,
    skipped: outcome.skipped,
  };
});
