import type { BlobRef, CycleId, StationId } from '../ids';
import { findStation, type Station } from '../line/snapshot';
import { err, ok, type Result } from '../result';
import type { DecideContext, DomainError } from './commands';
import type { Actor, OrderEvent } from './events';
import { isLive, latestCycle, requireCycle } from './evolve-helpers';
import type {
  ActiveJob,
  CycleState,
  QuestionRecord,
  WorkOrderState,
} from './state';

export type Decision = Result<OrderEvent[], DomainError>;

export const precondition = (detail: string): DomainError => ({
  code: 'precondition',
  detail,
});

/** `invalid` when there are issues, nothing otherwise. */
export const invalidIf = (issues: string[]): DomainError | undefined =>
  issues.length > 0 ? { code: 'invalid', issues } : undefined;

/** A delivered or cancelled Work order is terminal (CORE §4.2). */
export const refuseIfTerminal = (
  state: WorkOrderState,
): DomainError | undefined => {
  if (state.phase.kind === 'delivered') {
    return precondition('the Work order is delivered');
  }
  if (state.phase.kind === 'cancelled') {
    return precondition('the Work order is cancelled');
  }
  return undefined;
};

export const requireActor = (
  ctx: DecideContext,
  kinds: Actor['kind'][],
): DomainError | undefined =>
  kinds.includes(ctx.actor.kind)
    ? undefined
    : precondition(`actor ${ctx.actor.kind} may not run this command`);

/** The Supervisor's name, which the events record as `by`. Refuses any other actor. */
export const supervisorName = (
  ctx: DecideContext,
): Result<string, DomainError> =>
  ctx.actor.kind === 'supervisor'
    ? ok(ctx.actor.name)
    : err(precondition('only a supervisor may run this command'));

/** Epoch fence (CORE §5.2): the caller must hold the epoch of the active job. */
export const fenced = (
  state: WorkOrderState,
  ctx: DecideContext,
): Result<ActiveJob, DomainError> => {
  const job = state.activeJob;
  if (!job || ctx.epoch !== job.epoch) {
    return err({ code: 'stale_epoch', current: state.epoch });
  }
  return ok(job);
};

/** Whether the Cycle a job was claimed for has started (`cycle_started` applied). */
export const hasStarted = (state: WorkOrderState, job: ActiveJob): boolean =>
  job.cycleId !== undefined &&
  state.cycles.some((cycle) => cycle.cycleId === job.cycleId);

/** Liveness (CORE §4.3 rule 1): the Cycle is the latest one and still running. */
export const requireLive = (
  state: WorkOrderState,
  cycleId: CycleId,
): DomainError | undefined =>
  isLive(state, cycleId) ? undefined : { code: 'not_live', cycleId };

/** The Station of a Cycle the state already holds. A Cycle id that is not in the history is a bug. */
export const stationOfCycle = (
  state: WorkOrderState,
  cycleId: CycleId,
): Station => {
  const stationId: StationId = requireCycle(state, cycleId).stationId;
  const station = findStation(state.line, stationId);
  if (!station) {
    throw new Error(`station ${stationId} is not in line ${state.line.name}`);
  }
  return station;
};

/** The question of a Cycle that is still open, if any. */
const openQuestionOf = (
  state: WorkOrderState,
  cycleId: CycleId,
): QuestionRecord | undefined =>
  state.questions.find(
    (question) => question.status === 'open' && question.cycleId === cycleId,
  );

/**
 * CORE §5.2, the rule for all commands: when the events end a Cycle with an open question, the
 * question is abandoned in the same decision. Returns the abandon event for that case, or nothing.
 */
export const abandonOpen = (
  state: WorkOrderState,
  cycleId: CycleId,
): OrderEvent[] => {
  const question = openQuestionOf(state, cycleId);
  return question
    ? [{ type: 'question_abandoned', questionId: question.questionId }]
    : [];
};

/** The Cycle a job is running right now: started, and still live. Undefined otherwise. */
export const runningCycleOf = (
  state: WorkOrderState,
  job: ActiveJob,
): CycleId | undefined =>
  job.cycleId && isLive(state, job.cycleId) ? job.cycleId : undefined;

/**
 * Ends the active job without an outcome from its Cell: a running Cycle fails as `lost`, then the
 * job is lost (CORE §5.2, `ExpireLease`, `ReleaseJob`, `Cancel`).
 */
export const loseJob = (
  state: WorkOrderState,
  job: ActiveJob,
  reason: 'lease_expired' | 'cell_left' | 'cancelled',
  detail: string,
): OrderEvent[] => {
  const cycleId = runningCycleOf(state, job);
  const ending: OrderEvent[] = cycleId
    ? [
        ...abandonOpen(state, cycleId),
        { type: 'cycle_failed', cycleId, reason: 'lost', detail },
      ]
    : [];
  return [
    ...ending,
    { type: 'job_lost', jobId: job.jobId, epoch: job.epoch, reason },
  ];
};

/** Issues for every blob the command names that the runtime does not hold. */
export const missingBlobs = (
  ctx: DecideContext,
  refs: (BlobRef | undefined)[],
): string[] =>
  refs
    .filter((ref): ref is BlobRef => ref !== undefined)
    .filter((ref) => !ctx.blobs.exists(ref))
    .map((ref) => `blob ${ref} does not exist`);

/** The newest Cycle of the Work order, when its status is `running`. */
export const runningCycle = (state: WorkOrderState): CycleState | undefined => {
  const last = latestCycle(state);
  return last?.status === 'running' ? last : undefined;
};
