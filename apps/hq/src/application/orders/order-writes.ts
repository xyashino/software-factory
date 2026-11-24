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
import type {
  OrderPlanInsert,
  OrderPlanRow,
  ProjectRow,
  StorageReadTx,
  StorageWriteTx,
  WorkOrderInsert,
  WorkOrderRow,
} from '../ports/storage.port';

export type Actor = { kind: ActorKind; id: string | null };

export type TransitionLog = StateTransitionInput[];

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
  tx: StorageWriteTx,
  input: StateTransitionInput,
): StateTransitionRecord => ({
  ...input,
  seq: tx.transitions.append(input),
});

export const findProject = (
  tx: StorageReadTx,
  projectId: string,
): ProjectRow | undefined => tx.projects.find(asProjectId(projectId));

export const findPlan = (
  tx: StorageReadTx,
  planId: string,
): OrderPlanRow | undefined => tx.plans.find(asPlanId(planId));

export const findOrder = (
  tx: StorageReadTx,
  orderId: string,
): WorkOrderRow | undefined => tx.orders.find(asOrderId(orderId));

export const requireProject = (
  tx: StorageReadTx,
  projectId: string,
): ProjectRow => {
  const row = findProject(tx, projectId);
  if (row === undefined) throw new NotFound(`Project ${projectId} not found`);
  return row;
};

export const requirePlan = (
  tx: StorageReadTx,
  planId: string,
): OrderPlanRow => {
  const row = findPlan(tx, planId);
  if (row === undefined) throw new NotFound(`Order plan ${planId} not found`);
  return row;
};

export const requireOrder = (
  tx: StorageReadTx,
  orderId: string,
): WorkOrderRow => {
  const row = findOrder(tx, orderId);
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
  tx: StorageReadTx,
  row: WorkOrderRow,
): ResolvedBaseBranch =>
  resolveFor(
    { baseBranch: row.baseBranch, branch: row.branch },
    row.planId === null ? null : (findPlan(tx, row.planId) ?? null),
    row.parentOrderId === null
      ? null
      : (findOrder(tx, row.parentOrderId) ?? null),
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
  tx: StorageWriteTx,
  values: OrderPlanInsert,
): OrderPlanRow => tx.plans.insert(values);

export const insertWorkOrder = (
  tx: StorageWriteTx,
  values: WorkOrderInsert,
): WorkOrderRow => tx.orders.insert(values);

export const updateWorkOrder = (
  tx: StorageWriteTx,
  row: WorkOrderRow,
  patch: Partial<WorkOrderInsert>,
  now: number,
): WorkOrderRow =>
  tx.orders.update(row.orderId, {
    ...patch,
    version: row.version + 1,
    updatedAt: now,
  });

export const updateOrderPlan = (
  tx: StorageWriteTx,
  row: OrderPlanRow,
  state: PlanState,
  now: number,
): OrderPlanRow =>
  tx.plans.update(row.planId, {
    state,
    version: row.version + 1,
    updatedAt: now,
  });

export const insertPlanBranchJob = (
  tx: StorageWriteTx,
  plan: OrderPlanRow,
  repoUrl: string,
  now: number,
): void => {
  tx.jobs.insert({
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
  });
};

const releaseLease = (
  tx: StorageWriteTx,
  row: WorkOrderRow,
  now: number,
): void => {
  if (row.activeJobId !== null)
    tx.jobs.update(asJobId(row.activeJobId), {
      status: 'cancelled',
      finishedAt: now,
    });
};

const unlockChildren = (
  tx: StorageWriteTx,
  parent: WorkOrderRow,
  actor: Actor,
  now: number,
  log: TransitionLog,
): void => {
  const children = tx.orders.list({
    parentOrderId: parent.orderId,
    state: 'waiting_parent',
  });
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
  tx: StorageWriteTx,
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
  tx: StorageWriteTx,
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

export const settle = async <T>(run: () => Promise<T>): Promise<T> => {
  try {
    return await run();
  } catch (error) {
    if (error instanceof UnprocessableTransition)
      throw new UnprocessableEntity(error.message);
    throw error;
  }
};
