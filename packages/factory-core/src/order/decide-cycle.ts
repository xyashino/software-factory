import { err, ok } from '../result';
import type { CommandOf, DecideContext } from './commands';
import {
  type Decision,
  abandonOpen,
  fenced,
  hasStarted,
  invalidIf,
  missingBlobs,
  precondition,
  requireActor,
  requireLive,
  stationOfCycle,
} from './decide-guards';
import type { OrderEvent } from './events';
import { nextJob } from './next-job';
import type { WorkOrderState } from './state';

/**
 * Starts the Cycle the claimed job was given. The job's spec comes from `nextJob` on the state
 * without its active job, which is the state the claim was decided on. A run-pinned base must match
 * the Cell's base; a `branch_base` takes the Cell's commit.
 */
export const startCycle = (
  state: WorkOrderState,
  command: CommandOf<'StartCycle'>,
  ctx: DecideContext,
): Decision => {
  const denied = requireActor(ctx, ['cell']);
  if (denied) return err(denied);
  const fence = fenced(state, ctx);
  if (!fence.ok) return fence;
  const job = fence.value;
  if (hasStarted(state, job)) {
    return err(precondition('the Cycle has already started'));
  }
  const pending = nextJob({ ...state, activeJob: undefined });
  if (pending.kind !== 'job' || pending.job.kind === 'deliver') {
    return err(precondition('the claimed job is not a Station job'));
  }
  const spec = pending.job;
  if (spec.base !== 'branch_base' && spec.base !== command.baseCommit) {
    return err(precondition(`the base is not ${spec.base}`));
  }
  const baseCommit =
    spec.base === 'branch_base' ? command.baseCommit : spec.base;
  const problem = invalidIf(missingBlobs(ctx, [command.promptBlob]));
  if (problem) return err(problem);
  if (!job.cycleId) {
    return err(precondition('the claimed job has no Cycle'));
  }
  const events: OrderEvent[] = [
    {
      type: 'cycle_started',
      cycleId: job.cycleId,
      jobId: job.jobId,
      stationId: spec.stationId,
      n: spec.n,
      cause: spec.cause,
      baseCommit,
      operator: command.operator,
      promptBlob: command.promptBlob,
    },
  ];
  return ok(events);
};

/** An Operator station passed: its declared artifacts must all be in the workspace (CORE §5.2). */
export const completeCycle = (
  state: WorkOrderState,
  command: CommandOf<'CompleteCycle'>,
  ctx: DecideContext,
): Decision => {
  const denied = requireActor(ctx, ['operator']);
  if (denied) return err(denied);
  const fence = fenced(state, ctx);
  if (!fence.ok) return fence;
  const dead = requireLive(state, command.cycleId);
  if (dead) return err(dead);
  const station = stationOfCycle(state, command.cycleId);
  if (station.verdict) {
    return err(precondition(`${station.id} is a verdict Station`));
  }
  const issues = station.artifacts.flatMap((key) => {
    const blob = command.artifacts[key];
    if (!blob) return [`artifact ${key} is missing`];
    if (!ctx.blobs.exists(blob)) return [`artifact ${key} does not exist`];
    if (ctx.blobs.size(blob) === 0) return [`artifact ${key} is empty`];
    return [];
  });
  const problem = invalidIf(issues);
  if (problem) return err(problem);
  const events: OrderEvent[] = [
    ...abandonOpen(state, command.cycleId),
    {
      type: 'cycle_completed',
      cycleId: command.cycleId,
      artifacts: command.artifacts,
      commit: command.commit,
    },
  ];
  return ok(events);
};

/** A verdict Operator judged its Cycle; a failing verdict says why (CORE §5.2). */
export const submitVerdict = (
  state: WorkOrderState,
  command: CommandOf<'SubmitVerdict'>,
  ctx: DecideContext,
): Decision => {
  const denied = requireActor(ctx, ['operator']);
  if (denied) return err(denied);
  const fence = fenced(state, ctx);
  if (!fence.ok) return fence;
  const dead = requireLive(state, command.cycleId);
  if (dead) return err(dead);
  const station = stationOfCycle(state, command.cycleId);
  if (!station.verdict) {
    return err(precondition(`${station.id} is not a verdict Station`));
  }
  const issues = [
    ...(command.pass
      ? []
      : command.feedbackBlob
        ? []
        : ['a failing verdict needs feedbackBlob']),
    ...missingBlobs(ctx, [
      command.feedbackBlob,
      ...Object.values(command.artifacts),
    ]),
  ];
  const problem = invalidIf(issues);
  if (problem) return err(problem);
  const events: OrderEvent[] = [
    ...abandonOpen(state, command.cycleId),
    {
      type: 'verdict_recorded',
      cycleId: command.cycleId,
      pass: command.pass,
      artifacts: command.artifacts,
      feedbackBlob: command.feedbackBlob,
      commit: command.commit,
    },
  ];
  return ok(events);
};

export const reportInspection = (
  state: WorkOrderState,
  command: CommandOf<'ReportInspection'>,
  ctx: DecideContext,
): Decision => {
  const denied = requireActor(ctx, ['cell']);
  if (denied) return err(denied);
  const fence = fenced(state, ctx);
  if (!fence.ok) return fence;
  const dead = requireLive(state, command.cycleId);
  if (dead) return err(dead);
  const station = stationOfCycle(state, command.cycleId);
  if (station.kind !== 'inspection') {
    return err(precondition(`${station.id} is not an inspection Station`));
  }
  const problem = invalidIf(
    missingBlobs(
      ctx,
      command.results.map((result) => result.logBlob),
    ),
  );
  if (problem) return err(problem);
  const events: OrderEvent[] = [
    ...abandonOpen(state, command.cycleId),
    {
      type: 'inspection_finished',
      cycleId: command.cycleId,
      passed: command.passed,
      results: command.results,
    },
  ];
  return ok(events);
};

export const failCycle = (
  state: WorkOrderState,
  command: CommandOf<'FailCycle'>,
  ctx: DecideContext,
): Decision => {
  const denied = requireActor(ctx, ['cell']);
  if (denied) return err(denied);
  const fence = fenced(state, ctx);
  if (!fence.ok) return fence;
  const dead = requireLive(state, command.cycleId);
  if (dead) return err(dead);
  const events: OrderEvent[] = [
    ...abandonOpen(state, command.cycleId),
    {
      type: 'cycle_failed',
      cycleId: command.cycleId,
      reason: command.reason,
      detail: command.detail,
      wipCommit: command.wipCommit,
    },
  ];
  return ok(events);
};

/**
 * A Cycle stops because it cannot go on: the Operator with a Handover, or the runtime with a reason
 * (CORE §5.2). An operator block must carry its Handover.
 */
export const blockCycle = (
  state: WorkOrderState,
  command: CommandOf<'BlockCycle'>,
  ctx: DecideContext,
): Decision => {
  const denied = requireActor(ctx, ['operator', 'cell']);
  if (denied) return err(denied);
  const fence = fenced(state, ctx);
  if (!fence.ok) return fence;
  const dead = requireLive(state, command.cycleId);
  if (dead) return err(dead);
  const issues = [
    ...(command.source === 'operator' && !command.handoverBlob
      ? ['an operator block needs a handover']
      : []),
    ...missingBlobs(ctx, [command.handoverBlob]),
  ];
  const problem = invalidIf(issues);
  if (problem) return err(problem);
  const events: OrderEvent[] = [
    ...abandonOpen(state, command.cycleId),
    {
      type: 'cycle_blocked',
      cycleId: command.cycleId,
      source: command.source,
      reason: command.reason,
      detail: command.detail,
      handoverBlob: command.handoverBlob,
      commit: command.commit,
    },
  ];
  return ok(events);
};

export const handOverCycle = (
  state: WorkOrderState,
  command: CommandOf<'HandOverCycle'>,
  ctx: DecideContext,
): Decision => {
  const denied = requireActor(ctx, ['cell']);
  if (denied) return err(denied);
  const fence = fenced(state, ctx);
  if (!fence.ok) return fence;
  const dead = requireLive(state, command.cycleId);
  if (dead) return err(dead);
  const problem = invalidIf(missingBlobs(ctx, [command.handoverBlob]));
  if (problem) return err(problem);
  const events: OrderEvent[] = [
    ...abandonOpen(state, command.cycleId),
    {
      type: 'cycle_handed_over',
      cycleId: command.cycleId,
      handoverBlob: command.handoverBlob,
      commit: command.commit,
    },
  ];
  return ok(events);
};

/**
 * Usage arrives after the Cycle may have ended, so it has no epoch and no liveness check. Only the
 * Cell that ran the Cycle may record it (CORE §5.2).
 */
export const recordUsage = (
  state: WorkOrderState,
  command: CommandOf<'RecordUsage'>,
  ctx: DecideContext,
): Decision => {
  const denied = requireActor(ctx, ['cell']);
  if (denied) return err(denied);
  const cycle = state.cycles.find(
    (candidate) => candidate.cycleId === command.cycleId,
  );
  if (!cycle) return err({ code: 'not_found' });
  if (ctx.actor.kind !== 'cell' || ctx.actor.cellId !== cycle.cellId) {
    return err(precondition('only the Cell that ran the Cycle records usage'));
  }
  const events: OrderEvent[] = [
    {
      type: 'usage_recorded',
      cycleId: command.cycleId,
      model: command.model,
      inputTokens: command.inputTokens,
      outputTokens: command.outputTokens,
      costUsd: command.costUsd,
    },
  ];
  return ok(events);
};
