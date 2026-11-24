import { and, asc, eq, gt, inArray, isNull, lte, type SQL } from 'drizzle-orm';
import { type Db, type DbTx, immediateTx } from '../../db/client';
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

type Queryable = Db | DbTx;

const ACTIVE_JOB_STATUSES = ['claimed', 'running'] as const;
const OPEN_JOB_STATUSES = ['ready', 'claimed', 'running'] as const;

class DryRunRollback extends Error {}

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

const projectReads = (q: Queryable): ProjectReads => ({
  find: (projectId) =>
    q.select().from(projects).where(eq(projects.projectId, projectId)).get(),
  list: () => q.select().from(projects).orderBy(asc(projects.projectId)).all(),
});

const projectWrites = (tx: DbTx): ProjectWrites => ({
  ...projectReads(tx),
  insert: (row) => tx.insert(projects).values(row).returning().get(),
  update: (projectId, patch) =>
    tx
      .update(projects)
      .set(patch)
      .where(eq(projects.projectId, projectId))
      .returning()
      .get(),
});

const tokenReads = (q: Queryable): TokenReads => ({
  find: (tokenId) =>
    q.select().from(safeTokens).where(eq(safeTokens.tokenId, tokenId)).get(),
  findByHash: (tokenHash) =>
    q
      .select()
      .from(safeTokens)
      .where(eq(safeTokens.tokenHash, tokenHash))
      .get(),
  findActiveJoin: () =>
    q
      .select()
      .from(safeTokens)
      .where(and(eq(safeTokens.kind, 'web_join'), isNull(safeTokens.revokedAt)))
      .get(),
  findSuccessor: (rotatedFromId) =>
    q
      .select()
      .from(safeTokens)
      .where(eq(safeTokens.rotatedFromId, rotatedFromId))
      .get(),
});

const tokenWrites = (tx: DbTx): TokenWrites => ({
  ...tokenReads(tx),
  insert: (row) => tx.insert(safeTokens).values(row).returning().get(),
  update: (tokenId, patch) =>
    tx
      .update(safeTokens)
      .set(patch)
      .where(eq(safeTokens.tokenId, tokenId))
      .returning()
      .get(),
  revokeActiveOfKind: (kind, revokedAt) => {
    tx.update(safeTokens)
      .set({ revokedAt })
      .where(and(eq(safeTokens.kind, kind), isNull(safeTokens.revokedAt)))
      .run();
  },
});

const factoryReads = (q: Queryable): FactoryReads => ({
  list: () => q.select().from(factories).all(),
});

const factoryWrites = (tx: DbTx): FactoryWrites => ({
  ...factoryReads(tx),
  insert: (row) => tx.insert(factories).values(row).returning().get(),
  update: (factoryId, patch) =>
    tx
      .update(factories)
      .set(patch)
      .where(eq(factories.factoryId, factoryId))
      .returning()
      .get(),
});

const planReads = (q: Queryable): PlanReads => ({
  find: (planId) =>
    q.select().from(orderPlans).where(eq(orderPlans.planId, planId)).get(),
  list: (filter: PlanFilter) =>
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

const planWrites = (tx: DbTx): PlanWrites => ({
  ...planReads(tx),
  insert: (row) => tx.insert(orderPlans).values(row).returning().get(),
  update: (planId, patch) =>
    tx
      .update(orderPlans)
      .set(patch)
      .where(eq(orderPlans.planId, planId))
      .returning()
      .get(),
});

const orderReads = (q: Queryable): OrderReads => ({
  find: (orderId) =>
    q.select().from(workOrders).where(eq(workOrders.orderId, orderId)).get(),
  list: (filter) =>
    q.select().from(workOrders).where(orderConditions(filter)).all(),
  listQueued: (projectId) =>
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

const orderWrites = (tx: DbTx): OrderWrites => ({
  ...orderReads(tx),
  insert: (row) => tx.insert(workOrders).values(row).returning().get(),
  update: (orderId, patch) =>
    tx
      .update(workOrders)
      .set(patch)
      .where(eq(workOrders.orderId, orderId))
      .returning()
      .get(),
});

const stepReads = (q: Queryable): StepReads => ({
  find: (stepId) =>
    q.select().from(orderSteps).where(eq(orderSteps.stepId, stepId)).get(),
  listByOrder: (orderId) =>
    q
      .select()
      .from(orderSteps)
      .where(eq(orderSteps.orderId, orderId))
      .orderBy(asc(orderSteps.stepIndex))
      .all(),
});

const stepWrites = (tx: DbTx): StepWrites => ({
  ...stepReads(tx),
  insertMany: (rows) => {
    tx.insert(orderSteps).values(rows).run();
  },
  update: (stepId, patch) =>
    tx
      .update(orderSteps)
      .set(patch)
      .where(eq(orderSteps.stepId, stepId))
      .returning()
      .get(),
});

const jobReads = (q: Queryable): JobReads => ({
  find: (jobId) => q.select().from(jobs).where(eq(jobs.jobId, jobId)).get(),
  findActiveByCell: (cellId) =>
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
  findActiveByCellInFactory: (cellId, factoryId) =>
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
  listActiveByFactory: (factoryId) =>
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
  listExpired: (now) =>
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
  listReadyPlanBranches: (projectId) =>
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
  findReadyMechanic: (factoryId) =>
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
  findReadyRunOperator: (orderId) =>
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
  findActiveMechanic: (incidentId) =>
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
  listOpenMechanic: (incidentId) =>
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
  listByOrder: (orderId) =>
    q.select().from(jobs).where(eq(jobs.orderId, orderId)).all(),
});

const jobWrites = (tx: DbTx): JobWrites => ({
  ...jobReads(tx),
  insert: (row) => tx.insert(jobs).values(row).returning().get(),
  update: (jobId, patch) =>
    tx.update(jobs).set(patch).where(eq(jobs.jobId, jobId)).returning().get(),
});

const incidentReads = (q: Queryable): IncidentReads => ({
  find: (incidentId) =>
    q
      .select()
      .from(incidents)
      .where(eq(incidents.incidentId, incidentId))
      .get(),
  list: (filter: IncidentFilter) =>
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

const incidentWrites = (tx: DbTx): IncidentWrites => ({
  ...incidentReads(tx),
  insert: (row) => {
    tx.insert(incidents).values(row).run();
  },
  update: (incidentId, patch) =>
    tx
      .update(incidents)
      .set(patch)
      .where(eq(incidents.incidentId, incidentId))
      .returning()
      .get(),
});

const transitionReads = (q: Queryable): TransitionReads => ({
  findByCommand: (commandId) =>
    q
      .select()
      .from(stateTransitions)
      .where(eq(stateTransitions.commandId, commandId))
      .get(),
  listAfter: (afterSeq, projectId) =>
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

const transitionWrites = (tx: DbTx): TransitionWrites => ({
  ...transitionReads(tx),
  append: (input) =>
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
        commandId: input.commandId,
        metaJson: input.meta,
        at: input.at,
      })
      .returning({ seq: stateTransitions.seq })
      .get().seq,
});

const readRepos = (q: Queryable): StorageReadTx => ({
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

const writeRepos = (tx: DbTx): StorageWriteTx => ({
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

const runDryRun = <T>(db: Db, fn: (tx: StorageWriteTx) => T): T => {
  const outcome: { value?: { result: T } } = {};
  try {
    immediateTx(db, (tx) => {
      outcome.value = { result: fn(writeRepos(tx)) };
      throw new DryRunRollback();
    });
  } catch (error) {
    if (!(error instanceof DryRunRollback)) throw error;
  }
  if (outcome.value === undefined)
    throw new Error('dry run produced no result');
  return outcome.value.result;
};

export const createSqliteStorageAdapter = (db: Db): StoragePort => ({
  read: async (fn) => fn(readRepos(db)),
  write: async <T>(
    fn: (tx: StorageWriteTx) => T,
    options: StorageWriteOptions = {},
  ) =>
    options.dryRun === true
      ? runDryRun(db, fn)
      : immediateTx(db, (tx) => fn(writeRepos(tx))),
});
