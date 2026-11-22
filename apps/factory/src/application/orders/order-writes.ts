import { and, eq } from 'drizzle-orm';
import type { Db, DbTx } from '../../db/client';
import { jobs } from '../../db/schema/jobs';
import { workOrders } from '../../db/schema/orders';
import { orderPlans } from '../../db/schema/plans';
import { projects } from '../../db/schema/projects';
import { stateTransitions } from '../../db/schema/transitions';
import {
  asJobId,
  asOrderId,
  asPlanId,
  asProjectId,
  type CommandId,
  type ProjectId,
} from '../../domain/common/brand';
import type {
  ActorKind,
  EntityType,
  StateTransitionInput,
  StateTransitionRecord,
} from '../../domain/common/events';
import { UnprocessableTransition } from '../../domain/orders/job-transitions';
import type {
  PlanState,
  WorkOrderAction,
  WorkOrderState,
} from '../../domain/orders/order-state';
import {
  resolveBaseBranch,
  type ParentRef,
  type PlanRef,
  type ResolvedBaseBranch,
} from '../../domain/topology/resolve-base-branch';
import { NotFound, UnprocessableEntity } from '../core/error-handling';
import type { TransportContext } from '../core/procedure';
import type { OrderPlanRow, ProjectRow, WorkOrderRow } from './order-views';

export type Actor = { kind: ActorKind; id: string | null };

export type TransitionLog = StateTransitionInput[];

export type WorkOrderInsert = typeof workOrders.$inferInsert;
export type OrderPlanInsert = typeof orderPlans.$inferInsert;

type Queryable = Db | DbTx;

type TransitionArgs = {
  projectId: ProjectId;
  entityType: EntityType;
  entityId: string;
  fromState: string | null;
  toState: string;
  actor: Actor;
  at: number;
};

const planRefOf = (row: OrderPlanRow): PlanRef => ({
  state: row.state,
  baseBranch: row.baseBranch,
  branch: row.branch,
  branchCommitSha: row.branchCommitSha,
});

const parentRefOf = (row: WorkOrderRow): ParentRef => ({
  state: row.state,
  branch: row.branch,
  headCommitSha: row.headCommitSha,
});

const insertTransition = (
  tx: DbTx,
  input: StateTransitionInput,
): StateTransitionRecord => {
  const row = tx
    .insert(stateTransitions)
    .values({
      projectId: input.projectId,
      entityType: input.entityType,
      entityId: input.entityId,
      fromState: input.fromState,
      toState: input.toState,
      actorKind: input.actorKind,
      actorId: input.actorId,
      commandId: input.commandId,
      metaJson: input.meta,
      at: input.at,
    })
    .returning({ seq: stateTransitions.seq })
    .get();
  return { ...input, seq: row.seq };
};

export const findProject = (
  db: Queryable,
  projectId: string,
): ProjectRow | undefined =>
  db
    .select()
    .from(projects)
    .where(eq(projects.projectId, asProjectId(projectId)))
    .get();

export const findPlan = (
  db: Queryable,
  planId: string,
): OrderPlanRow | undefined =>
  db
    .select()
    .from(orderPlans)
    .where(eq(orderPlans.planId, asPlanId(planId)))
    .get();

export const findOrder = (
  db: Queryable,
  orderId: string,
): WorkOrderRow | undefined =>
  db
    .select()
    .from(workOrders)
    .where(eq(workOrders.orderId, asOrderId(orderId)))
    .get();

export const requireProject = (
  db: Queryable,
  projectId: string,
): ProjectRow => {
  const row = findProject(db, projectId);
  if (row === undefined) throw new NotFound(`Project ${projectId} not found`);
  return row;
};

export const requirePlan = (db: Queryable, planId: string): OrderPlanRow => {
  const row = findPlan(db, planId);
  if (row === undefined) throw new NotFound(`Order plan ${planId} not found`);
  return row;
};

export const requireOrder = (db: Queryable, orderId: string): WorkOrderRow => {
  const row = findOrder(db, orderId);
  if (row === undefined) throw new NotFound(`Work order ${orderId} not found`);
  return row;
};

export const resolveFor = (
  order: { baseBranch: string; branch: string },
  plan: OrderPlanRow | null,
  parent: WorkOrderRow | null,
): ResolvedBaseBranch =>
  resolveBaseBranch({
    kind: 'order',
    order,
    plan: plan === null ? null : planRefOf(plan),
    parent: parent === null ? null : parentRefOf(parent),
  });

export const readinessOf = (
  db: Queryable,
  row: WorkOrderRow,
): ResolvedBaseBranch =>
  resolveFor(
    { baseBranch: row.baseBranch, branch: row.branch },
    row.planId === null ? null : (findPlan(db, row.planId) ?? null),
    row.parentOrderId === null
      ? null
      : (findOrder(db, row.parentOrderId) ?? null),
  );

export const orderTransition = (
  args: TransitionArgs,
): StateTransitionInput => ({
  projectId: args.projectId,
  entityType: args.entityType,
  entityId: args.entityId,
  fromState: args.fromState,
  toState: args.toState,
  actorKind: args.actor.kind,
  actorId: args.actor.id,
  commandId: null,
  meta: null,
  at: args.at,
});

export const insertOrderPlan = (
  tx: DbTx,
  values: OrderPlanInsert,
): OrderPlanRow => tx.insert(orderPlans).values(values).returning().get();

export const insertWorkOrder = (
  tx: DbTx,
  values: WorkOrderInsert,
): WorkOrderRow => tx.insert(workOrders).values(values).returning().get();

export const updateWorkOrder = (
  tx: DbTx,
  row: WorkOrderRow,
  patch: Partial<WorkOrderInsert>,
  now: number,
): WorkOrderRow =>
  tx
    .update(workOrders)
    .set({ ...patch, version: row.version + 1, updatedAt: now })
    .where(eq(workOrders.orderId, row.orderId))
    .returning()
    .get();

export const updateOrderPlan = (
  tx: DbTx,
  row: OrderPlanRow,
  state: PlanState,
  now: number,
): OrderPlanRow =>
  tx
    .update(orderPlans)
    .set({ state, version: row.version + 1, updatedAt: now })
    .where(eq(orderPlans.planId, row.planId))
    .returning()
    .get();

export const insertPlanBranchJob = (
  tx: DbTx,
  plan: OrderPlanRow,
  repoUrl: string,
  now: number,
): void => {
  tx.insert(jobs)
    .values({
      jobId: asJobId(`job-${crypto.randomUUID()}`),
      projectId: plan.projectId,
      planId: plan.planId,
      kind: 'plan_branch',
      workspaceMode: 'fresh',
      status: 'ready',
      repoUrl,
      baseBranch: plan.baseBranch,
      targetBranch: plan.branch,
      expectedPriorStepsJson: [],
      payloadJson: { planId: plan.planId },
      epoch: 0,
      createdAt: now,
    })
    .run();
};

const releaseLease = (tx: DbTx, row: WorkOrderRow, now: number): void => {
  if (row.activeJobId !== null)
    tx.update(jobs)
      .set({ status: 'cancelled', finishedAt: now })
      .where(eq(jobs.jobId, asJobId(row.activeJobId)))
      .run();
};

const unlockChildren = (
  tx: DbTx,
  parent: WorkOrderRow,
  actor: Actor,
  now: number,
  log: TransitionLog,
): void => {
  const children = tx
    .select()
    .from(workOrders)
    .where(
      and(
        eq(workOrders.parentOrderId, parent.orderId),
        eq(workOrders.state, 'waiting_parent'),
      ),
    )
    .all();
  for (const child of children) {
    if (!readinessOf(tx, child).isReady) continue;
    updateWorkOrder(tx, child, { state: 'queued' }, now);
    log.push(
      orderTransition({
        projectId: child.projectId,
        entityType: 'work_order',
        entityId: child.orderId,
        fromState: 'waiting_parent',
        toState: 'queued',
        actor,
        at: now,
      }),
    );
  }
};

export const moveOrder = (
  tx: DbTx,
  row: WorkOrderRow,
  next: WorkOrderState,
  action: WorkOrderAction,
  actor: Actor,
  now: number,
  log: TransitionLog,
): WorkOrderRow => {
  const patch: Partial<WorkOrderInsert> = { state: next };
  if (action === 'cancel') {
    releaseLease(tx, row, now);
    patch.activeJobId = null;
    patch.activeCellId = null;
    patch.pinnedFactoryId = null;
  }
  if (action === 'reset_to_scratch') {
    patch.currentStepIndex = 0;
    patch.unavailableLineFactoriesJson = [];
  }
  const updated = updateWorkOrder(tx, row, patch, now);
  log.push(
    orderTransition({
      projectId: row.projectId,
      entityType: 'work_order',
      entityId: row.orderId,
      fromState: row.state,
      toState: next,
      actor,
      at: now,
    }),
  );
  if (next === 'completed') unlockChildren(tx, updated, actor, now, log);
  return updated;
};

export const flushTransitions = (
  tx: DbTx,
  log: TransitionLog,
  command?: { commandId: CommandId; meta: Record<string, unknown> },
): StateTransitionRecord[] =>
  log.map((input, index) => {
    const owner = index === 0 ? command : undefined;
    return insertTransition(tx, {
      ...input,
      commandId: owner?.commandId ?? null,
      meta: owner?.meta ?? input.meta,
    });
  });

export const publishCommitted = (
  ctx: TransportContext,
  records: readonly StateTransitionRecord[],
): void => {
  if (records.length === 0) return;
  ctx.transitionBus.publish(records);
  if (
    records.some(
      (record) => record.toState === 'queued' || record.toState === 'branching',
    )
  )
    ctx.claimWaiters.wakeAll();
};

export const settle = <T>(run: () => T): T => {
  try {
    return run();
  } catch (error) {
    if (error instanceof UnprocessableTransition)
      throw new UnprocessableEntity(error.message);
    throw error;
  }
};
