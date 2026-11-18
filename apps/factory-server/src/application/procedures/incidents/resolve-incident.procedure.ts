import { and, asc, eq, inArray } from 'drizzle-orm';
import type { z } from 'zod';
import { resolveIncidentContract } from '../../../contracts/incidents.contract';
import { immediateTx, type DbTx } from '../../../db/client';
import { incidents } from '../../../db/schema/incidents';
import { jobs } from '../../../db/schema/jobs';
import { orderSteps } from '../../../db/schema/orders';
import {
  asCellId,
  asIncidentId,
  type CellId,
  type IncidentId,
  type OrderId,
} from '../../../domain/common/brand';
import {
  resolveIncident,
  type IncidentSnapshot,
  type Resolution,
  type WorkOrderSnapshot,
} from '../../../domain/incidents/incident-rules';
import {
  BadRequest,
  Forbidden,
  NotFound,
  StaleLeaseEpoch,
} from '../../core/error-handling';
import { anyScopedProcedure } from '../../core/procedure';
import type { Principal } from '../../ports/auth.port';
import { toIncidentDto } from '../../orders/incident-views';
import {
  toIncidentSnapshot,
  toWorkOrderSnapshot,
} from '../../orders/incident-writes';
import {
  flushTransitions,
  orderTransition,
  publishCommitted,
  releaseCell,
  requireOrder,
  settle,
  updateWorkOrder,
  type Actor,
  type TransitionLog,
} from '../../orders/order-writes';
import { toWorkOrderDto, type WorkOrderRow } from '../../orders/order-views';

const ACTIVE_JOB_STATUSES = ['claimed', 'running'] as const;
const OPEN_JOB_STATUSES = ['ready', 'claimed', 'running'] as const;

type ResolveBody = z.infer<typeof resolveIncidentContract.in.body>;
type IncidentRow = typeof incidents.$inferSelect;
type JobRow = typeof jobs.$inferSelect;
type StepRow = typeof orderSteps.$inferSelect;
type MechanicResolver = { kind: 'mechanic'; cellId: CellId; epoch: number };
type SupervisorResolver = { kind: 'supervisor'; tokenId: string };
type Resolver = MechanicResolver | SupervisorResolver;

const resolverOf = (principal: Principal, body: ResolveBody): Resolver => {
  if (principal.scopes.includes('supervisor:write'))
    return { kind: 'supervisor', tokenId: principal.tokenId };
  if (principal.cellId === null)
    throw new Forbidden('Token is not bound to a cell');
  if (body.epoch === undefined)
    throw new BadRequest('epoch is required for a cell resolution');
  return { kind: 'mechanic', cellId: principal.cellId, epoch: body.epoch };
};

const actorOf = (resolver: Resolver): Actor =>
  resolver.kind === 'supervisor'
    ? { kind: 'supervisor', id: resolver.tokenId }
    : { kind: 'mechanic', id: resolver.cellId };

const toResolution = (body: ResolveBody): Resolution => {
  switch (body.action) {
    case 'retry_step':
      return { action: 'retry_step', stepIndex: body.stepIndex };
    case 'restart_from_step':
      return { action: 'restart_from_step', stepIndex: body.stepIndex };
    case 'restart_from_scratch':
    case 'escalate':
    case 'cancel':
      return { action: body.action };
  }
};

const requireIncident = (tx: DbTx, incidentId: string): IncidentRow => {
  const row = tx
    .select()
    .from(incidents)
    .where(eq(incidents.incidentId, asIncidentId(incidentId)))
    .get();
  if (row === undefined) throw new NotFound(`Incident ${incidentId} not found`);
  return row;
};

const stepsOf = (tx: DbTx, orderId: OrderId): StepRow[] =>
  tx
    .select()
    .from(orderSteps)
    .where(eq(orderSteps.orderId, orderId))
    .orderBy(asc(orderSteps.stepIndex))
    .all();

const requireMechanicLease = (
  tx: DbTx,
  incidentId: IncidentId,
  resolver: MechanicResolver,
): void => {
  const job: JobRow | undefined = tx
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.incidentId, incidentId),
        eq(jobs.kind, 'mechanic'),
        inArray(jobs.status, ACTIVE_JOB_STATUSES),
      ),
    )
    .get();
  if (job === undefined || job.cellId !== resolver.cellId)
    throw new Forbidden(
      `Cell ${resolver.cellId} holds no mechanic lease for incident ${incidentId}`,
    );
  if (job.epoch !== resolver.epoch)
    throw new StaleLeaseEpoch(
      `Mechanic job ${job.jobId} epoch ${resolver.epoch} is stale`,
    );
};

const closeMechanicJobs = (
  tx: DbTx,
  incidentId: IncidentId,
  status: 'passed' | 'cancelled',
  actor: Actor,
  now: number,
  log: TransitionLog,
): void => {
  const open = tx
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.incidentId, incidentId),
        eq(jobs.kind, 'mechanic'),
        inArray(jobs.status, OPEN_JOB_STATUSES),
      ),
    )
    .all();
  for (const job of open) {
    tx.update(jobs)
      .set({ status, finishedAt: now })
      .where(eq(jobs.jobId, job.jobId))
      .run();
    if (job.cellId !== null && job.status !== 'ready')
      releaseCell(tx, job.cellId);
    log.push(
      orderTransition({
        projectId: job.projectId,
        entityType: 'job',
        entityId: job.jobId,
        fromState: job.status,
        toState: status,
        actor,
        at: now,
      }),
    );
  }
};

const persistOrder = (
  tx: DbTx,
  order: WorkOrderRow,
  next: WorkOrderSnapshot,
  actor: Actor,
  now: number,
  log: TransitionLog,
): WorkOrderRow => {
  const updated = updateWorkOrder(
    tx,
    order,
    {
      state: next.state,
      currentStepIndex: next.currentStepIndex,
      unavailableLineCellsJson: next.unavailableLineCells,
      staleBase: next.staleBase,
      worktreeResets: next.worktreeResets,
      pinnedCellId:
        next.pinnedCellId === null ? null : asCellId(next.pinnedCellId),
    },
    now,
  );
  if (next.state !== order.state)
    log.push(
      orderTransition({
        projectId: order.projectId,
        entityType: 'work_order',
        entityId: order.orderId,
        fromState: order.state,
        toState: next.state,
        actor,
        at: now,
      }),
    );
  return updated;
};

const persistSteps = (
  tx: DbTx,
  steps: readonly StepRow[],
  next: WorkOrderSnapshot,
  now: number,
): void => {
  for (const row of steps) {
    const step = next.steps.find(
      (candidate) => candidate.stepIndex === row.stepIndex,
    );
    if (step === undefined) continue;
    const rerun =
      next.state === 'queued' && row.stepIndex >= next.currentStepIndex;
    tx.update(orderSteps)
      .set({
        state: rerun ? 'pending' : row.state,
        attemptsUsed: step.attemptsUsed,
        maxAttempts: step.maxAttempts,
        updatedAt: now,
      })
      .where(eq(orderSteps.stepId, row.stepId))
      .run();
  }
};

const persistIncident = (
  tx: DbTx,
  incident: IncidentRow,
  next: IncidentSnapshot,
  actor: Actor,
  now: number,
  log: TransitionLog,
): IncidentRow => {
  const closed = next.status === 'resolved' || next.status === 'cancelled';
  const updated = tx
    .update(incidents)
    .set({
      status: next.status,
      triageOwner: next.triageOwner,
      resolutionAction: next.resolutionAction,
      resolvedBy: closed ? actor.id : null,
      resolvedAt: closed ? now : null,
    })
    .where(eq(incidents.incidentId, incident.incidentId))
    .returning()
    .get();
  log.push(
    orderTransition({
      projectId: incident.projectId,
      entityType: 'incident',
      entityId: incident.incidentId,
      fromState: incident.status,
      toState: next.status,
      actor,
      at: now,
    }),
  );
  return updated;
};

export const resolveIncidentProcedure = anyScopedProcedure([
  'supervisor:write',
  'cell:worker',
])(resolveIncidentContract)((input, ctx) => {
  const now = ctx.clock.now();
  const resolver = resolverOf(ctx.principal, input.body);
  const actor = actorOf(resolver);
  const outcome = settle(() =>
    immediateTx(ctx.db, (tx) => {
      const incident = requireIncident(tx, input.params.id);
      const order = requireOrder(tx, incident.orderId);
      const steps = stepsOf(tx, order.orderId);
      if (resolver.kind === 'mechanic')
        requireMechanicLease(tx, incident.incidentId, resolver);
      const result = resolveIncident(
        toIncidentSnapshot(incident, steps),
        toWorkOrderSnapshot(order, steps),
        toResolution(input.body),
      );
      const log: TransitionLog = [];
      closeMechanicJobs(
        tx,
        incident.incidentId,
        resolver.kind === 'mechanic' ? 'passed' : 'cancelled',
        actor,
        now,
        log,
      );
      const updatedOrder = persistOrder(
        tx,
        order,
        result.workOrder,
        actor,
        now,
        log,
      );
      persistSteps(tx, steps, result.workOrder, now);
      const updatedIncident = persistIncident(
        tx,
        incident,
        result.incident,
        actor,
        now,
        log,
      );
      return {
        response: {
          code: 200 as const,
          incident: toIncidentDto(updatedIncident),
          workOrder: toWorkOrderDto(updatedOrder),
        },
        records: flushTransitions(tx, log),
      };
    }),
  );
  publishCommitted(ctx, outcome.records);
  return outcome.response;
});
