import { createWorkOrderContract } from '@repo/hq-contracts/work-orders.contract';
import { asOrderId } from '../../../domain/common/brand';
import { scopedId } from '../../../domain/common/scoped-id';
import { orderBranchOf } from '../../../domain/topology/branch-names';
import { Conflict, UnprocessableEntity } from '../../core/error-handling';
import { scopedProcedure } from '../../core/procedure';
import {
  findOrder,
  flushTransitions,
  insertWorkOrder,
  orderTransition,
  publishCommitted,
  requireOrder,
  requirePlan,
  requireProject,
  resolveFor,
  type Actor,
  type TransitionLog,
} from '../../orders/order-writes';
import { toWorkOrderDto } from '../../orders/order-views';

export const createWorkOrderProcedure = scopedProcedure(['supervisor:write'])(
  createWorkOrderContract,
)(async (input, ctx) => {
  const body = input.body;
  const now = ctx.clock.now();
  const actor: Actor = { kind: 'supervisor', id: ctx.principal.tokenId };

  const { row, records } = await ctx.storage.write((tx) => {
    const project = requireProject(tx, body.projectId);
    const orderId = asOrderId(scopedId(project.projectId, body.slug));
    if (findOrder(tx, orderId) !== undefined)
      throw new Conflict(`Work order ${body.slug} already exists`);
    if (body.parentSlug === body.slug)
      throw new UnprocessableEntity('A work order cannot depend on itself');

    const plan =
      body.planSlug == null
        ? null
        : requirePlan(tx, scopedId(project.projectId, body.planSlug));
    const parent =
      body.parentSlug == null
        ? null
        : requireOrder(tx, scopedId(project.projectId, body.parentSlug));
    const branch = orderBranchOf(body.slug);
    const resolved = resolveFor(
      { baseBranch: project.defaultBaseBranch, branch },
      plan,
      parent,
    );

    const row = insertWorkOrder(tx, {
      orderId,
      projectId: project.projectId,
      planId: plan?.planId ?? null,
      parentOrderId: parent?.orderId ?? null,
      slug: body.slug,
      title: body.title,
      type: body.type,
      description: body.description,
      lineName: body.lineName,
      unavailableLineFactoriesJson: [],
      priority: body.priority,
      baseBranch: resolved.baseBranch,
      baseCommitSha: resolved.baseCommitSha,
      branch,
      state: resolved.initialState,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
    const log: TransitionLog = [
      orderTransition({
        projectId: project.projectId,
        entityType: 'work_order',
        entityId: orderId,
        fromState: null,
        toState: row.state,
        actor,
        at: now,
      }),
    ];
    return { row, records: flushTransitions(tx, log) };
  });

  publishCommitted(ctx, records);
  return { code: 201 as const, order: toWorkOrderDto(row) };
});
