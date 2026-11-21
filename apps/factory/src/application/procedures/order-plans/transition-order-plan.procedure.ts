import { immediateTx } from '../../../db/client';
import { transitionOrderPlanContract } from '../../../contracts/order-plans.contract';
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
  updateOrderPlan,
  type Actor,
  type TransitionLog,
} from '../../orders/order-writes';
import { toOrderPlanDto } from '../../orders/order-views';

export const transitionOrderPlanProcedure = scopedProcedure([
  'supervisor:write',
])(transitionOrderPlanContract)((input, ctx) => {
  const { action } = input.body;
  const now = ctx.clock.now();
  const actor: Actor = { kind: 'supervisor', id: ctx.principal.tokenId };

  const { row, records } = immediateTx(ctx.db, (tx) => {
    const plan = requirePlan(tx, input.params.id);
    const next = nextPlanState(plan.state, action);
    if (next === null)
      throw new Conflict(`Order plan cannot ${action} from ${plan.state}`);
    const row = updateOrderPlan(tx, plan, next, now);
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
    if (next === 'branching')
      insertPlanBranchJob(
        tx,
        row,
        requireProject(tx, plan.projectId).repoUrl,
        now,
      );
    return { row, records: flushTransitions(tx, log) };
  });

  publishCommitted(ctx, records);
  return { code: 200 as const, plan: toOrderPlanDto(row) };
});
