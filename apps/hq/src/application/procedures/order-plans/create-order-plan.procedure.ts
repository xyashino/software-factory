import { createOrderPlanContract } from '@repo/hq-contracts/order-plans.contract';
import { asPlanId } from '../../../domain/common/brand';
import { scopedId } from '../../../domain/common/scoped-id';
import type { PlanState } from '../../../domain/orders/order-state';
import { planBranchOf } from '../../../domain/topology/branch-names';
import { Conflict } from '../../core/error-handling';
import { scopedProcedure } from '../../core/procedure';
import {
  findPlan,
  flushTransitions,
  insertOrderPlan,
  insertPlanBranchJob,
  orderTransition,
  publishCommitted,
  requireProject,
  type Actor,
  type TransitionLog,
} from '../../orders/order-writes';
import { toOrderPlanDto } from '../../orders/order-views';

export const createOrderPlanProcedure = scopedProcedure(['supervisor:write'])(
  createOrderPlanContract,
)(async (input, ctx) => {
  const { projectId, slug, title, baseBranch, activate } = input.body;
  const now = ctx.clock.now();
  const actor: Actor = { kind: 'supervisor', id: ctx.principal.tokenId };
  const planId = asPlanId(scopedId(projectId, slug));

  const { row, records } = await ctx.storage.write((tx) => {
    const project = requireProject(tx, projectId);
    if (findPlan(tx, planId) !== undefined)
      throw new Conflict(`Order plan ${slug} already exists`);
    const state: PlanState = activate ? 'branching' : 'draft';
    const row = insertOrderPlan(tx, {
      planId,
      projectId: project.projectId,
      slug,
      title,
      baseBranch: baseBranch ?? project.defaultBaseBranch,
      branch: planBranchOf(slug),
      branchCommitSha: null,
      state,
      failureDetail: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
    const log: TransitionLog = [
      orderTransition({
        projectId: project.projectId,
        entityType: 'order_plan',
        entityId: planId,
        fromState: null,
        toState: state,
        actor,
        at: now,
      }),
    ];
    if (activate) insertPlanBranchJob(tx, row, project.repoUrl, now);
    return { row, records: flushTransitions(tx, log) };
  });

  publishCommitted(ctx, records);
  return { code: 201 as const, plan: toOrderPlanDto(row) };
});
