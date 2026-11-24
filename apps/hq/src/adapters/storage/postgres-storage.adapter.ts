import { and, asc, eq, gt, inArray, isNull, lte, type SQL } from 'drizzle-orm';
import { type PgDb, type PgTx, createPgDb } from '../../db/pg/client';
import { factories } from '../../db/pg/schema/factories';
import { incidents } from '../../db/pg/schema/incidents';
import { jobs } from '../../db/pg/schema/jobs';
import { orderSteps, workOrders } from '../../db/pg/schema/orders';
import { orderPlans } from '../../db/pg/schema/plans';
import { projects } from '../../db/pg/schema/projects';
import { safeTokens } from '../../db/pg/schema/tokens';
import { stateTransitions } from '../../db/pg/schema/transitions';
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

type Queryable = PgDb | PgTx;

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

const one = async <T>(query: PromiseLike<T[]>): Promise<T | undefined> =>
  (await query)[0];

const required = async <T>(query: PromiseLike<T[]>): Promise<T> => {
  const row = await one(query);
  if (row === undefined) throw new Error('storage write returned no row');
  return row;
};

const projectReads = (q: Queryable): ProjectReads => ({
  find: (projectId) =>
    one(q.select().from(projects).where(eq(projects.projectId, projectId))),
  list: async () => q.select().from(projects).orderBy(asc(projects.projectId)),
});

const projectWrites = (tx: Queryable): ProjectWrites => ({
  ...projectReads(tx),
  insert: (row) => required(tx.insert(projects).values(row).returning()),
  update: (projectId, patch) =>
    required(
      tx
        .update(projects)
        .set(patch)
        .where(eq(projects.projectId, projectId))
        .returning(),
    ),
});

const tokenReads = (q: Queryable, lock: boolean): TokenReads => ({
  find: (tokenId) =>
    one(
      lock
        ? q
            .select()
            .from(safeTokens)
            .where(eq(safeTokens.tokenId, tokenId))
            .for('update')
        : q.select().from(safeTokens).where(eq(safeTokens.tokenId, tokenId)),
    ),
  findByHash: (tokenHash) =>
    one(q.select().from(safeTokens).where(eq(safeTokens.tokenHash, tokenHash))),
  findActiveJoin: () =>
    one(
      lock
        ? q
            .select()
            .from(safeTokens)
            .where(
              and(
                eq(safeTokens.kind, 'web_join'),
                isNull(safeTokens.revokedAt),
              ),
            )
            .for('update')
        : q
            .select()
            .from(safeTokens)
            .where(
              and(
                eq(safeTokens.kind, 'web_join'),
                isNull(safeTokens.revokedAt),
              ),
            ),
    ),
  findSuccessor: (rotatedFromId) =>
    one(
      q
        .select()
        .from(safeTokens)
        .where(eq(safeTokens.rotatedFromId, rotatedFromId)),
    ),
});

const tokenWrites = (tx: PgTx): TokenWrites => ({
  ...tokenReads(tx, true),
  insert: (row) => required(tx.insert(safeTokens).values(row).returning()),
  update: (tokenId, patch) =>
    required(
      tx
        .update(safeTokens)
        .set(patch)
        .where(eq(safeTokens.tokenId, tokenId))
        .returning(),
    ),
  revokeActiveOfKind: async (kind, revokedAt) => {
    await tx
      .update(safeTokens)
      .set({ revokedAt })
      .where(and(eq(safeTokens.kind, kind), isNull(safeTokens.revokedAt)));
  },
});

const factoryReads = (q: Queryable): FactoryReads => ({
  list: async () => q.select().from(factories),
});

const factoryWrites = (tx: PgTx): FactoryWrites => ({
  ...factoryReads(tx),
  insert: (row) => required(tx.insert(factories).values(row).returning()),
  update: (factoryId, patch) =>
    required(
      tx
        .update(factories)
        .set(patch)
        .where(eq(factories.factoryId, factoryId))
        .returning(),
    ),
});

const planReads = (q: Queryable): PlanReads => ({
  find: (planId) =>
    one(q.select().from(orderPlans).where(eq(orderPlans.planId, planId))),
  list: async (filter: PlanFilter) =>
    q
      .select()
      .from(orderPlans)
      .where(
        and(
          eq(orderPlans.projectId, filter.projectId),
          when(filter.state, (state) => eq(orderPlans.state, state)),
        ),
      ),
});

const planWrites = (tx: PgTx): PlanWrites => ({
  ...planReads(tx),
  insert: (row) => required(tx.insert(orderPlans).values(row).returning()),
  update: (planId, patch) =>
    required(
      tx
        .update(orderPlans)
        .set(patch)
        .where(eq(orderPlans.planId, planId))
        .returning(),
    ),
});

const orderReads = (q: Queryable, lock: boolean): OrderReads => ({
  find: (orderId) =>
    one(
      lock
        ? q
            .select()
            .from(workOrders)
            .where(eq(workOrders.orderId, orderId))
            .for('update')
        : q.select().from(workOrders).where(eq(workOrders.orderId, orderId)),
    ),
  list: async (filter) =>
    q.select().from(workOrders).where(orderConditions(filter)),
  listQueued: async (projectId) =>
    lock
      ? q
          .select()
          .from(workOrders)
          .where(
            and(
              eq(workOrders.projectId, projectId),
              eq(workOrders.state, 'queued'),
            ),
          )
          .orderBy(asc(workOrders.createdAt), asc(workOrders.orderId))
          .for('update')
      : q
          .select()
          .from(workOrders)
          .where(
            and(
              eq(workOrders.projectId, projectId),
              eq(workOrders.state, 'queued'),
            ),
          )
          .orderBy(asc(workOrders.createdAt), asc(workOrders.orderId)),
});

const orderWrites = (tx: PgTx): OrderWrites => ({
  ...orderReads(tx, true),
  insert: (row) => required(tx.insert(workOrders).values(row).returning()),
  update: (orderId, patch) =>
    required(
      tx
        .update(workOrders)
        .set(patch)
        .where(eq(workOrders.orderId, orderId))
        .returning(),
    ),
});

const stepReads = (q: Queryable): StepReads => ({
  find: (stepId) =>
    one(q.select().from(orderSteps).where(eq(orderSteps.stepId, stepId))),
  listByOrder: async (orderId) =>
    q
      .select()
      .from(orderSteps)
      .where(eq(orderSteps.orderId, orderId))
      .orderBy(asc(orderSteps.stepIndex)),
});

const stepWrites = (tx: PgTx): StepWrites => ({
  ...stepReads(tx),
  insertMany: async (rows) => {
    await tx.insert(orderSteps).values(rows);
  },
  update: (stepId, patch) =>
    required(
      tx
        .update(orderSteps)
        .set(patch)
        .where(eq(orderSteps.stepId, stepId))
        .returning(),
    ),
});

const jobReads = (q: Queryable, lock: boolean): JobReads => ({
  find: (jobId) =>
    one(
      lock
        ? q.select().from(jobs).where(eq(jobs.jobId, jobId)).for('update')
        : q.select().from(jobs).where(eq(jobs.jobId, jobId)),
    ),
  findActiveByCell: (cellId) =>
    one(
      q
        .select()
        .from(jobs)
        .where(
          and(
            eq(jobs.claimedByCellId, cellId),
            inArray(jobs.status, ACTIVE_JOB_STATUSES),
          ),
        ),
    ),
  findActiveByCellInFactory: (cellId, factoryId) =>
    one(
      q
        .select()
        .from(jobs)
        .where(
          and(
            eq(jobs.claimedByCellId, cellId),
            eq(jobs.claimedByFactoryId, factoryId),
            inArray(jobs.status, ACTIVE_JOB_STATUSES),
          ),
        ),
    ),
  listActiveByFactory: async (factoryId) =>
    q
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.claimedByFactoryId, factoryId),
          inArray(jobs.status, ACTIVE_JOB_STATUSES),
        ),
      ),
  listExpired: async (now) =>
    q
      .select()
      .from(jobs)
      .where(
        and(
          inArray(jobs.status, ACTIVE_JOB_STATUSES),
          lte(jobs.leaseExpiresAt, now),
        ),
      ),
  listReadyPlanBranches: async (projectId) => {
    const query = q
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.projectId, projectId),
          eq(jobs.kind, 'plan_branch'),
          eq(jobs.status, 'ready'),
        ),
      )
      .orderBy(asc(jobs.createdAt), asc(jobs.jobId));
    return lock ? query.for('update') : query;
  },
  findReadyMechanic: async (factoryId) => {
    const query = q
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.kind, 'mechanic'),
          eq(jobs.status, 'ready'),
          eq(jobs.claimedByFactoryId, factoryId),
        ),
      )
      .orderBy(asc(jobs.createdAt), asc(jobs.jobId));
    return one(lock ? query.for('update') : query);
  },
  findReadyRunOperator: (orderId) =>
    one(
      lock
        ? q
            .select()
            .from(jobs)
            .where(
              and(
                eq(jobs.orderId, orderId),
                eq(jobs.kind, 'run_operator'),
                eq(jobs.status, 'ready'),
              ),
            )
            .for('update')
        : q
            .select()
            .from(jobs)
            .where(
              and(
                eq(jobs.orderId, orderId),
                eq(jobs.kind, 'run_operator'),
                eq(jobs.status, 'ready'),
              ),
            ),
    ),
  findActiveMechanic: (incidentId) =>
    one(
      q
        .select()
        .from(jobs)
        .where(
          and(
            eq(jobs.incidentId, incidentId),
            eq(jobs.kind, 'mechanic'),
            inArray(jobs.status, ACTIVE_JOB_STATUSES),
          ),
        ),
    ),
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
      ),
  listByOrder: async (orderId) =>
    q.select().from(jobs).where(eq(jobs.orderId, orderId)),
});

const jobWrites = (tx: PgTx): JobWrites => ({
  ...jobReads(tx, true),
  insert: (row) => required(tx.insert(jobs).values(row).returning()),
  update: (jobId, patch) =>
    required(
      tx.update(jobs).set(patch).where(eq(jobs.jobId, jobId)).returning(),
    ),
});

const incidentReads = (q: Queryable): IncidentReads => ({
  find: (incidentId) =>
    one(q.select().from(incidents).where(eq(incidents.incidentId, incidentId))),
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
      ),
});

const incidentWrites = (tx: PgTx): IncidentWrites => ({
  ...incidentReads(tx),
  insert: async (row) => {
    await tx.insert(incidents).values(row);
  },
  update: (incidentId, patch) =>
    required(
      tx
        .update(incidents)
        .set(patch)
        .where(eq(incidents.incidentId, incidentId))
        .returning(),
    ),
});

const transitionReads = (q: Queryable): TransitionReads => ({
  findByCommand: (commandId) =>
    one(
      q
        .select()
        .from(stateTransitions)
        .where(eq(stateTransitions.commandId, commandId)),
    ),
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
      .orderBy(asc(stateTransitions.seq)),
});

const transitionWrites = (tx: PgTx): TransitionWrites => ({
  ...transitionReads(tx),
  append: async (input) =>
    (
      await required(
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
          .returning({ seq: stateTransitions.seq }),
      )
    ).seq,
});

const readRepos = (q: Queryable): StorageReadTx => ({
  projects: projectReads(q),
  tokens: tokenReads(q, false),
  factories: factoryReads(q),
  plans: planReads(q),
  orders: orderReads(q, false),
  steps: stepReads(q),
  jobs: jobReads(q, false),
  incidents: incidentReads(q),
  transitions: transitionReads(q),
});

const writeRepos = (tx: PgTx): StorageWriteTx => ({
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

const runDryRun = async <T>(
  db: PgDb,
  fn: (tx: StorageWriteTx) => T | Promise<T>,
): Promise<T> => {
  const outcome: { value?: { result: T } } = {};
  try {
    await db.transaction(async (tx) => {
      outcome.value = { result: await fn(writeRepos(tx)) };
      throw new DryRunRollback();
    });
  } catch (error) {
    if (!(error instanceof DryRunRollback)) throw error;
  }
  if (outcome.value === undefined)
    throw new Error('dry run produced no result');
  return outcome.value.result;
};

export const createPostgresStorageAdapter = async (
  databaseUrl: string,
): Promise<StoragePort> => {
  const db = await createPgDb(databaseUrl);
  return {
    read: async (fn) => fn(readRepos(db)),
    write: async <T>(
      fn: (tx: StorageWriteTx) => T | Promise<T>,
      options: StorageWriteOptions = {},
    ) =>
      options.dryRun === true
        ? runDryRun(db, fn)
        : db.transaction(async (tx) => fn(writeRepos(tx))),
  };
};
