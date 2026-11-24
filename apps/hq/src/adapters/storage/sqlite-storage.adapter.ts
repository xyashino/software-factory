import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNull,
  lte,
  type SQL,
  sql,
} from 'drizzle-orm';
import { type Db } from '../../db/client';
import { factories } from '../../db/schema/factories';
import { incidents } from '../../db/schema/incidents';
import { jobs } from '../../db/schema/jobs';
import { orderSteps, workOrders } from '../../db/schema/orders';
import { orderPlans } from '../../db/schema/plans';
import { projects } from '../../db/schema/projects';
import { safeTokens } from '../../db/schema/tokens';
import { stateTransitions } from '../../db/schema/transitions';
import type {
  FactoryReads,
  FactoryWrites,
  IncidentFilter,
  IncidentReads,
  IncidentWrites,
  JobReads,
  JobWrites,
  OrderFilter,
  OrderReads,
  OrderWrites,
  PlanFilter,
  PlanReads,
  PlanWrites,
  ProjectReads,
  ProjectWrites,
  StepReads,
  StepWrites,
  StoragePort,
  StorageReadTx,
  StorageWriteOptions,
  StorageWriteTx,
  TokenReads,
  TokenWrites,
  TransitionReads,
  TransitionWrites,
} from '../../application/ports/storage.port';

const ACTIVE_JOB_STATUSES = ['claimed', 'running'] as const;
const OPEN_JOB_STATUSES = ['ready', 'claimed', 'running'] as const;

const when = <T>(
  value: T | undefined,
  condition: (value: T) => SQL,
): SQL | undefined => (value === undefined ? undefined : condition(value));

const orderConditions = (filter: OrderFilter): SQL | undefined =>
  and(
    when(filter.projectId, (id) => eq(workOrders.projectId, id)),
    when(filter.planId, (id) => eq(workOrders.planId, id)),
    filter.parentOrderId === undefined
      ? undefined
      : filter.parentOrderId === null
        ? isNull(workOrders.parentOrderId)
        : eq(workOrders.parentOrderId, filter.parentOrderId),
    when(filter.lineName, (name) => eq(workOrders.lineName, name)),
    when(filter.state, (state) => eq(workOrders.state, state)),
    when(filter.pinnedFactoryId, (id) => eq(workOrders.pinnedFactoryId, id)),
  );

const serialized = () => {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task);
    tail = run.catch(() => undefined);
    return run;
  };
};

const projectReads = (q: Db): ProjectReads => ({
  find: async (projectId) =>
    q.select().from(projects).where(eq(projects.projectId, projectId)).get(),
  list: async () =>
    q.select().from(projects).orderBy(asc(projects.projectId)).all(),
});

const projectWrites = (tx: Db): ProjectWrites => ({
  ...projectReads(tx),
  insert: async (row) => tx.insert(projects).values(row).returning().get(),
  update: async (projectId, patch) =>
    tx
      .update(projects)
      .set(patch)
      .where(eq(projects.projectId, projectId))
      .returning()
      .get(),
});

const tokenReads = (q: Db): TokenReads => ({
  find: async (tokenId) =>
    q.select().from(safeTokens).where(eq(safeTokens.tokenId, tokenId)).get(),
  findByHash: async (tokenHash) =>
    q
      .select()
      .from(safeTokens)
      .where(eq(safeTokens.tokenHash, tokenHash))
      .get(),
  findActiveJoin: async () =>
    q
      .select()
      .from(safeTokens)
      .where(and(eq(safeTokens.kind, 'web_join'), isNull(safeTokens.revokedAt)))
      .get(),
  findSuccessor: async (rotatedFromId) =>
    q
      .select()
      .from(safeTokens)
      .where(eq(safeTokens.rotatedFromId, rotatedFromId))
      .get(),
});

const tokenWrites = (tx: Db): TokenWrites => ({
  ...tokenReads(tx),
  insert: async (row) => tx.insert(safeTokens).values(row).returning().get(),
  update: async (tokenId, patch) =>
    tx
      .update(safeTokens)
      .set(patch)
      .where(eq(safeTokens.tokenId, tokenId))
      .returning()
      .get(),
  revokeActiveOfKind: async (kind, revokedAt) => {
    tx.update(safeTokens)
      .set({ revokedAt })
      .where(and(eq(safeTokens.kind, kind), isNull(safeTokens.revokedAt)))
      .run();
  },
});

const factoryReads = (q: Db): FactoryReads => ({
  list: async () => q.select().from(factories).all(),
});

const factoryWrites = (tx: Db): FactoryWrites => ({
  ...factoryReads(tx),
  insert: async (row) => tx.insert(factories).values(row).returning().get(),
  update: async (factoryId, patch) =>
    tx
      .update(factories)
      .set(patch)
      .where(eq(factories.factoryId, factoryId))
      .returning()
      .get(),
});

const planReads = (q: Db): PlanReads => ({
  find: async (planId) =>
    q.select().from(orderPlans).where(eq(orderPlans.planId, planId)).get(),
  list: async (filter: PlanFilter) =>
    q
      .select()
      .from(orderPlans)
      .where(
        and(
          eq(orderPlans.projectId, filter.projectId),
          when(filter.state, (state) => eq(orderPlans.state, state)),
        ),
      )
      .all(),
});

const planWrites = (tx: Db): PlanWrites => ({
  ...planReads(tx),
  insert: async (row) => tx.insert(orderPlans).values(row).returning().get(),
  update: async (planId, patch) =>
    tx
      .update(orderPlans)
      .set(patch)
      .where(eq(orderPlans.planId, planId))
      .returning()
      .get(),
});

const orderReads = (q: Db): OrderReads => ({
  find: async (orderId) =>
    q.select().from(workOrders).where(eq(workOrders.orderId, orderId)).get(),
  list: async (filter) =>
    q.select().from(workOrders).where(orderConditions(filter)).all(),
  listQueued: async (projectId) =>
    q
      .select()
      .from(workOrders)
      .where(
        and(
          eq(workOrders.projectId, projectId),
          eq(workOrders.state, 'queued'),
        ),
      )
      .orderBy(asc(workOrders.createdAt), asc(workOrders.orderId))
      .all(),
});

const orderWrites = (tx: Db): OrderWrites => ({
  ...orderReads(tx),
  insert: async (row) => tx.insert(workOrders).values(row).returning().get(),
  update: async (orderId, patch) =>
    tx
      .update(workOrders)
      .set(patch)
      .where(eq(workOrders.orderId, orderId))
      .returning()
      .get(),
});

const stepReads = (q: Db): StepReads => ({
  find: async (stepId) =>
    q.select().from(orderSteps).where(eq(orderSteps.stepId, stepId)).get(),
  listByOrder: async (orderId) =>
    q
      .select()
      .from(orderSteps)
      .where(eq(orderSteps.orderId, orderId))
      .orderBy(asc(orderSteps.stepIndex))
      .all(),
});

const stepWrites = (tx: Db): StepWrites => ({
  ...stepReads(tx),
  insertMany: async (rows) => {
    tx.insert(orderSteps).values(rows).run();
  },
  update: async (stepId, patch) =>
    tx
      .update(orderSteps)
      .set(patch)
      .where(eq(orderSteps.stepId, stepId))
      .returning()
      .get(),
});

const jobReads = (q: Db): JobReads => ({
  find: async (jobId) =>
    q.select().from(jobs).where(eq(jobs.jobId, jobId)).get(),
  findActiveByCell: async (cellId) =>
    q
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.claimedByCellId, cellId),
          inArray(jobs.status, ACTIVE_JOB_STATUSES),
        ),
      )
      .get(),
  findActiveByCellInFactory: async (cellId, factoryId) =>
    q
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.claimedByCellId, cellId),
          eq(jobs.claimedByFactoryId, factoryId),
          inArray(jobs.status, ACTIVE_JOB_STATUSES),
        ),
      )
      .get(),
  listActiveByFactory: async (factoryId) =>
    q
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.claimedByFactoryId, factoryId),
          inArray(jobs.status, ACTIVE_JOB_STATUSES),
        ),
      )
      .all(),
  listExpired: async (now) =>
    q
      .select()
      .from(jobs)
      .where(
        and(
          inArray(jobs.status, ACTIVE_JOB_STATUSES),
          lte(jobs.leaseExpiresAt, now),
        ),
      )
      .all(),
  listReadyPlanBranches: async (projectId) =>
    q
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.projectId, projectId),
          eq(jobs.kind, 'plan_branch'),
          eq(jobs.status, 'ready'),
        ),
      )
      .orderBy(asc(jobs.createdAt), asc(jobs.jobId))
      .all(),
  findReadyMechanic: async (factoryId) =>
    q
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.kind, 'mechanic'),
          eq(jobs.status, 'ready'),
          eq(jobs.claimedByFactoryId, factoryId),
        ),
      )
      .orderBy(asc(jobs.createdAt), asc(jobs.jobId))
      .get(),
  findReadyRunOperator: async (orderId) =>
    q
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.orderId, orderId),
          eq(jobs.kind, 'run_operator'),
          eq(jobs.status, 'ready'),
        ),
      )
      .get(),
  findActiveMechanic: async (incidentId) =>
    q
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.incidentId, incidentId),
          eq(jobs.kind, 'mechanic'),
          inArray(jobs.status, ACTIVE_JOB_STATUSES),
        ),
      )
      .get(),
  listOpenMechanic: async (incidentId) =>
    q
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.incidentId, incidentId),
          eq(jobs.kind, 'mechanic'),
          inArray(jobs.status, OPEN_JOB_STATUSES),
        ),
      )
      .all(),
  listByOrder: async (orderId) =>
    q.select().from(jobs).where(eq(jobs.orderId, orderId)).all(),
});

const jobWrites = (tx: Db): JobWrites => ({
  ...jobReads(tx),
  insert: async (row) => tx.insert(jobs).values(row).returning().get(),
  update: async (jobId, patch) =>
    tx.update(jobs).set(patch).where(eq(jobs.jobId, jobId)).returning().get(),
});

const incidentReads = (q: Db): IncidentReads => ({
  find: async (incidentId) =>
    q
      .select()
      .from(incidents)
      .where(eq(incidents.incidentId, incidentId))
      .get(),
  list: async (filter: IncidentFilter) =>
    q
      .select()
      .from(incidents)
      .where(
        and(
          eq(incidents.projectId, filter.projectId),
          when(filter.orderId, (id) => eq(incidents.orderId, id)),
          when(filter.reason, (reason) => eq(incidents.reason, reason)),
          when(filter.status, (status) => eq(incidents.status, status)),
        ),
      )
      .all(),
});

const incidentWrites = (tx: Db): IncidentWrites => ({
  ...incidentReads(tx),
  insert: async (row) => {
    tx.insert(incidents).values(row).run();
  },
  update: async (incidentId, patch) =>
    tx
      .update(incidents)
      .set(patch)
      .where(eq(incidents.incidentId, incidentId))
      .returning()
      .get(),
});

const transitionReads = (q: Db): TransitionReads => ({
  findByCommand: async (commandId) =>
    q
      .select()
      .from(stateTransitions)
      .where(eq(stateTransitions.commandId, commandId))
      .get(),
  listAfter: async (afterSeq, projectId) =>
    q
      .select()
      .from(stateTransitions)
      .where(
        and(
          gt(stateTransitions.seq, afterSeq),
          when(projectId, (id) => eq(stateTransitions.projectId, id)),
        ),
      )
      .orderBy(asc(stateTransitions.seq))
      .all(),
});

const transitionWrites = (tx: Db): TransitionWrites => ({
  ...transitionReads(tx),
  append: async (input) =>
    tx
      .insert(stateTransitions)
      .values({
        projectId: input.projectId,
        entityType: input.entityType,
        entityId: input.entityId,
        fromState: input.fromState,
        toState: input.toState,
        actorKind: input.actorKind,
        actorId: input.actorId,
        actorLabel: input.actorLabel,
        commandId: input.commandId,
        metaJson: input.meta,
        at: input.at,
      })
      .returning({ seq: stateTransitions.seq })
      .get().seq,
});

const readRepos = (q: Db): StorageReadTx => ({
  projects: projectReads(q),
  tokens: tokenReads(q),
  factories: factoryReads(q),
  plans: planReads(q),
  orders: orderReads(q),
  steps: stepReads(q),
  jobs: jobReads(q),
  incidents: incidentReads(q),
  transitions: transitionReads(q),
});

const writeRepos = (tx: Db): StorageWriteTx => ({
  projects: projectWrites(tx),
  tokens: tokenWrites(tx),
  factories: factoryWrites(tx),
  plans: planWrites(tx),
  orders: orderWrites(tx),
  steps: stepWrites(tx),
  jobs: jobWrites(tx),
  incidents: incidentWrites(tx),
  transitions: transitionWrites(tx),
});

const runWrite = async <T>(
  db: Db,
  fn: (tx: StorageWriteTx) => T | Promise<T>,
  options: StorageWriteOptions,
): Promise<T> => {
  db.run(sql`BEGIN IMMEDIATE`);
  let result: T;
  try {
    result = await fn(writeRepos(db));
  } catch (error) {
    db.run(sql`ROLLBACK`);
    throw error;
  }
  db.run(options.dryRun === true ? sql`ROLLBACK` : sql`COMMIT`);
  return result;
};

export const createSqliteStorageAdapter = (db: Db): StoragePort => {
  const exclusive = serialized();
  return {
    read: (fn) => exclusive(async () => fn(readRepos(db))),
    write: (fn, options = {}) => exclusive(() => runWrite(db, fn, options)),
  };
};
