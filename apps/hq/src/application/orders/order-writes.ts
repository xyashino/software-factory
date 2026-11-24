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
import {
  readyOrWaiting,
  type PlanState,
  type WorkOrderAction,
  type WorkOrderState,
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

const PLAN_RESET_SKIPPED_STATES: readonly WorkOrderState[] = [
  'delivered',
  'completed',
  'cancelled',
];

export type Actor = { kind: ActorKind; id: string | null };

export type TransitionLog = StateTransitionInput[];

export type ChildOutcome = { slug: string; state: WorkOrderState };

export type PlanResetOutcome = {
  reset: ChildOutcome[];
  skipped: ChildOutcome[];
};

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

const insertTransition = async (
  tx: StorageWriteTx,
  input: StateTransitionInput,
): Promise<StateTransitionRecord> => ({
  ...input,
  seq: await tx.transitions.append(input),
});

export const findProject = (
  tx: StorageReadTx,
  projectId: string,
): Promise<ProjectRow | undefined> => tx.projects.find(asProjectId(projectId));

export const findPlan = (
  tx: StorageReadTx,
  planId: string,
): Promise<OrderPlanRow | undefined> => tx.plans.find(asPlanId(planId));

export const findOrder = (
  tx: StorageReadTx,
  orderId: string,
): Promise<WorkOrderRow | undefined> => tx.orders.find(asOrderId(orderId));

export const requireProject = async (
  tx: StorageReadTx,
  projectId: string,
): Promise<ProjectRow> => {
  const row = await findProject(tx, projectId);
  if (row === undefined) throw new NotFound(`Project ${projectId} not found`);
  return row;
};

export const requirePlan = async (
  tx: StorageReadTx,
  planId: string,
): Promise<OrderPlanRow> => {
  const row = await findPlan(tx, planId);
  if (row === undefined) throw new NotFound(`Order plan ${planId} not found`);
  return row;
};

export const requireOrder = async (
  tx: StorageReadTx,
  orderId: string,
): Promise<WorkOrderRow> => {
  const row = await findOrder(tx, orderId);
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

export const readinessOf = async (
  tx: StorageReadTx,
  row: WorkOrderRow,
): Promise<ResolvedBaseBranch> =>
  resolveFor(
    { baseBranch: row.baseBranch, branch: row.branch },
    row.planId === null ? null : ((await findPlan(tx, row.planId)) ?? null),
    row.parentOrderId === null
      ? null
      : ((await findOrder(tx, row.parentOrderId)) ?? null),
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
): Promise<OrderPlanRow> => tx.plans.insert(values);

export const insertWorkOrder = (
  tx: StorageWriteTx,
  values: WorkOrderInsert,
): Promise<WorkOrderRow> => tx.orders.insert(values);

export const updateWorkOrder = (
  tx: StorageWriteTx,
  row: WorkOrderRow,
  patch: Partial<WorkOrderInsert>,
  now: number,
): Promise<WorkOrderRow> =>
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
): Promise<OrderPlanRow> =>
  tx.plans.update(row.planId, {
    state,
    version: row.version + 1,
    updatedAt: now,
  });

export const insertPlanBranchJob = async (
  tx: StorageWriteTx,
  plan: OrderPlanRow,
  repoUrl: string,
  now: number,
  fresh = false,
): Promise<void> => {
  await tx.jobs.insert({
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
    payloadJson: { planId: plan.planId, fresh },
    epoch: 0,
    createdAt: now,
  });
};

const releaseLease = async (
  tx: StorageWriteTx,
  row: WorkOrderRow,
  now: number,
): Promise<void> => {
  if (row.activeJobId !== null)
    await tx.jobs.update(asJobId(row.activeJobId), {
      status: 'cancelled',
      finishedAt: now,
    });
};

export const resetChildrenToScratch = async (
  tx: StorageWriteTx,
  plan: OrderPlanRow,
  actor: Actor,
  now: number,
  log: TransitionLog,
): Promise<PlanResetOutcome> => {
  const outcome: PlanResetOutcome = { reset: [], skipped: [] };
  const children = await tx.orders.list({ planId: plan.planId });
  for (const child of children) {
    if (PLAN_RESET_SKIPPED_STATES.includes(child.state)) {
      outcome.skipped.push({ slug: child.slug, state: child.state });
      continue;
    }
    await releaseLease(tx, child, now);
    const next =
      child.state === 'paused'
        ? 'paused'
        : readyOrWaiting((await readinessOf(tx, child)).isReady);
    await updateWorkOrder(
      tx,
      child,
      {
        state: next,
        currentStepIndex: 0,
        unavailableLineFactoriesJson: [],
        activeJobId: null,
        activeCellId: null,
        pinnedFactoryId: null,
      },
      now,
    );
    log.push(
      orderTransition({
        projectId: child.projectId,
        entityType: 'work_order',
        entityId: child.orderId,
        fromState: child.state,
        toState: next,
        actor,
        at: now,
      }),
    );
    outcome.reset.push({ slug: child.slug, state: next });
  }
  return outcome;
};

const unlockChildren = async (
  tx: StorageWriteTx,
  parent: WorkOrderRow,
  actor: Actor,
  now: number,
  log: TransitionLog,
): Promise<void> => {
  const children = await tx.orders.list({
    parentOrderId: parent.orderId,
    state: 'waiting_parent',
  });
  for (const child of children) {
    if (!(await readinessOf(tx, child)).isReady) continue;
    await updateWorkOrder(tx, child, { state: 'queued' }, now);
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

export const moveOrder = async (
  tx: StorageWriteTx,
  row: WorkOrderRow,
  next: WorkOrderState,
  action: WorkOrderAction,
  actor: Actor,
  now: number,
  log: TransitionLog,
): Promise<WorkOrderRow> => {
  const patch: Partial<WorkOrderInsert> = { state: next };
  if (action === 'cancel') {
    await releaseLease(tx, row, now);
    patch.activeJobId = null;
    patch.activeCellId = null;
    patch.pinnedFactoryId = null;
  }
  if (action === 'reset_to_scratch') {
    patch.currentStepIndex = 0;
    patch.unavailableLineFactoriesJson = [];
  }
  const updated = await updateWorkOrder(tx, row, patch, now);
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
  if (next === 'completed') await unlockChildren(tx, updated, actor, now, log);
  return updated;
};

export const flushTransitions = async (
  tx: StorageWriteTx,
  log: TransitionLog,
  command?: { commandId: CommandId; meta: Record<string, unknown> },
): Promise<StateTransitionRecord[]> => {
  const records: StateTransitionRecord[] = [];
  for (const [index, input] of log.entries()) {
    const owner = index === 0 ? command : undefined;
    records.push(
      await insertTransition(tx, {
        ...input,
        commandId: owner?.commandId ?? null,
        meta: owner?.meta ?? input.meta,
      }),
    );
  }
  return records;
};

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
