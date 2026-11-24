import type { z } from 'zod';
import { resolveIncidentContract } from '@repo/hq-contracts/incidents.contract';
import {
  asFactoryId,
  asIncidentId,
  type CellId,
  type FactoryId,
  type IncidentId,
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
import { cellIdOf, factoryIdOf, touchFactory } from '../../core/identity';
import {
  anyScopedProcedure,
  type AuthenticatedContext,
} from '../../core/procedure';
import type {
  IncidentRow,
  OrderStepRow,
  StorageWriteTx,
  WorkOrderRow,
} from '../../ports/storage.port';
import { toIncidentDto } from '../../orders/incident-views';
import {
  toIncidentSnapshot,
  toWorkOrderSnapshot,
} from '../../orders/incident-writes';
import {
  flushTransitions,
  orderTransition,
  publishCommitted,
  requireOrder,
  settle,
  updateWorkOrder,
  type Actor,
  type TransitionLog,
} from '../../orders/order-writes';
import { toWorkOrderDto } from '../../orders/order-views';

type ResolveBody = z.infer<typeof resolveIncidentContract.in.body>;
type MechanicResolver = {
  kind: 'mechanic';
  cellId: CellId;
  factoryId: FactoryId;
  epoch: number;
};
type SupervisorResolver = { kind: 'supervisor'; tokenId: string };
type Resolver = MechanicResolver | SupervisorResolver;

const resolverOf = (ctx: AuthenticatedContext, body: ResolveBody): Resolver => {
  if (ctx.principal.scopes.includes('supervisor:write'))
    return { kind: 'supervisor', tokenId: ctx.principal.tokenId };
  if (body.epoch === undefined)
    throw new BadRequest('epoch is required for a cell resolution');
  return {
    kind: 'mechanic',
    cellId: cellIdOf(ctx),
    factoryId: factoryIdOf(ctx),
    epoch: body.epoch,
  };
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

const requireIncident = (
  tx: StorageWriteTx,
  incidentId: string,
): IncidentRow => {
  const row = tx.incidents.find(asIncidentId(incidentId));
  if (row === undefined) throw new NotFound(`Incident ${incidentId} not found`);
  return row;
};

const requireMechanicLease = (
  tx: StorageWriteTx,
  incidentId: IncidentId,
  resolver: MechanicResolver,
): void => {
  const job = tx.jobs.findActiveMechanic(incidentId);
  if (job === undefined || job.claimedByCellId !== resolver.cellId)
    throw new Forbidden(
      `Cell ${resolver.cellId} holds no mechanic lease for incident ${incidentId}`,
    );
  if (job.epoch !== resolver.epoch)
    throw new StaleLeaseEpoch(
      `Mechanic job ${job.jobId} epoch ${resolver.epoch} is stale`,
    );
};

const closeMechanicJobs = (
  tx: StorageWriteTx,
  incidentId: IncidentId,
  status: 'passed' | 'cancelled',
  actor: Actor,
  now: number,
  log: TransitionLog,
): void => {
  for (const job of tx.jobs.listOpenMechanic(incidentId)) {
    tx.jobs.update(job.jobId, { status, finishedAt: now });
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
  tx: StorageWriteTx,
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
      unavailableLineFactoriesJson: next.unavailableLineFactories,
      staleBase: next.staleBase,
      worktreeResets: next.worktreeResets,
      pinnedFactoryId:
        next.pinnedFactoryId === null
          ? null
          : asFactoryId(next.pinnedFactoryId),
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
  tx: StorageWriteTx,
  steps: readonly OrderStepRow[],
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
    tx.steps.update(row.stepId, {
      state: rerun ? 'pending' : row.state,
      attemptsUsed: step.attemptsUsed,
      maxAttempts: step.maxAttempts,
      updatedAt: now,
    });
  }
};

const persistIncident = (
  tx: StorageWriteTx,
  incident: IncidentRow,
  next: IncidentSnapshot,
  actor: Actor,
  now: number,
  log: TransitionLog,
): IncidentRow => {
  const closed = next.status === 'resolved' || next.status === 'cancelled';
  const updated = tx.incidents.update(incident.incidentId, {
    status: next.status,
    triageOwner: next.triageOwner,
    resolutionAction: next.resolutionAction,
    resolvedBy: closed ? actor.id : null,
    resolvedAt: closed ? now : null,
  });
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
  'factory:worker',
])(resolveIncidentContract)(async (input, ctx) => {
  const now = ctx.clock.now();
  const resolver = resolverOf(ctx, input.body);
  const actor = actorOf(resolver);
  const outcome = await settle(() =>
    ctx.storage.write((tx) => {
      if (resolver.kind === 'mechanic')
        touchFactory(tx, resolver.factoryId, now);
      const incident = requireIncident(tx, input.params.id);
      const order = requireOrder(tx, incident.orderId);
      const steps = tx.steps.listByOrder(order.orderId);
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
