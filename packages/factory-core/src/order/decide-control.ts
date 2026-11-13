import { questionIdSchema, resumeIdSchema } from '../ids';
import { findStation, stationIndex } from '../line/snapshot';
import { err, ok } from '../result';
import type { CommandOf, DecideContext } from './commands';
import {
  type Decision,
  fenced,
  invalidIf,
  missingBlobs,
  precondition,
  refuseIfTerminal,
  requireActor,
  requireLive,
  runningCycle,
  stationOfCycle,
  supervisorName,
} from './decide-guards';
import type { OrderEvent } from './events';
import type { WorkOrderState } from './state';

/** The Operator asks the Supervisor one question; only one may be open at a time (CORE §5.2). */
export const askQuestion = (
  state: WorkOrderState,
  command: CommandOf<'AskQuestion'>,
  ctx: DecideContext,
): Decision => {
  const denied = requireActor(ctx, ['operator']);
  if (denied) return err(denied);
  const fence = fenced(state, ctx);
  if (!fence.ok) return fence;
  const dead = requireLive(state, command.cycleId);
  if (dead) return err(dead);
  if (state.questions.some((question) => question.status === 'open')) {
    return err(precondition('a question is already open'));
  }
  const events: OrderEvent[] = [
    {
      type: 'question_asked',
      cycleId: command.cycleId,
      questionId: questionIdSchema.parse(ctx.ids.next()),
      text: command.text,
    },
  ];
  return ok(events);
};

/**
 * The Supervisor answers a question that is open, or abandoned and not yet answered. The answer
 * reaches the next Cycle of the Station through `priorQuestions` (CORE §9.2).
 */
export const answer = (
  state: WorkOrderState,
  command: CommandOf<'Answer'>,
  ctx: DecideContext,
): Decision => {
  const by = supervisorName(ctx);
  if (!by.ok) return by;
  const question = state.questions.find(
    (candidate) => candidate.questionId === command.questionId,
  );
  if (!question) return err({ code: 'not_found' });
  if (question.status === 'answered') {
    return err(precondition('the question is already answered'));
  }
  const events: OrderEvent[] = [
    {
      type: 'question_answered',
      questionId: command.questionId,
      by: by.value,
      text: command.text,
    },
  ];
  return ok(events);
};

/** A note goes to a later Station or to the Supervisor (CORE §5.2). */
export const leaveNote = (
  state: WorkOrderState,
  command: CommandOf<'LeaveNote'>,
  ctx: DecideContext,
): Decision => {
  const denied = requireActor(ctx, ['operator']);
  if (denied) return err(denied);
  const fence = fenced(state, ctx);
  if (!fence.ok) return fence;
  const dead = requireLive(state, command.cycleId);
  if (dead) return err(dead);
  if (command.to !== 'supervisor') {
    const current = stationOfCycle(state, command.cycleId);
    const here = stationIndex(state.line, current.id);
    const there = stationIndex(state.line, command.to);
    if (there === undefined || here === undefined || there <= here) {
      return err(precondition(`${command.to} is not a later Station`));
    }
  }
  const events: OrderEvent[] = [
    {
      type: 'note_left',
      cycleId: command.cycleId,
      to: command.to,
      text: command.text,
    },
  ];
  return ok(events);
};

/** A nudge goes to the Cycle that is running right now (CORE §5.2). */
export const nudge = (
  state: WorkOrderState,
  command: CommandOf<'Nudge'>,
  ctx: DecideContext,
): Decision => {
  const by = supervisorName(ctx);
  if (!by.ok) return by;
  const cycle = runningCycle(state);
  if (!cycle) return err(precondition('no Cycle is running'));
  const events: OrderEvent[] = [
    {
      type: 'nudged',
      cycleId: cycle.cycleId,
      by: by.value,
      text: command.text,
    },
  ];
  return ok(events);
};

/**
 * The Supervisor resumes an Andon. A retry grant defaults to 1 for `retries_exhausted` and is never
 * 0 (CORE §5.2).
 */
export const resume = (
  state: WorkOrderState,
  command: CommandOf<'Resume'>,
  ctx: DecideContext,
): Decision => {
  const by = supervisorName(ctx);
  if (!by.ok) return by;
  // A cancelled Work order stays cancelled: an Andon raised before the cancel does not reopen it.
  const terminal = refuseIfTerminal(state);
  if (terminal) return err(terminal);
  const andon = state.andon;
  if (!andon) return err(precondition('no Andon is raised'));
  if (command.grantRetries === 0) {
    return err({
      code: 'invalid',
      issues: ['grantRetries must be at least 1'],
    });
  }
  const { mode } = command;
  if (
    mode.kind === 'restart_from' &&
    !findStation(state.line, mode.stationId)
  ) {
    return err(precondition(`${mode.stationId} is not in the Line`));
  }
  // A restart moves the Work order back. Ahead of where it stopped, it would skip Stations that never
  // passed, and delivery would then have no checkpoint (CORE §4.3 rule 8).
  if (mode.kind === 'restart_from') {
    const target = stationIndex(state.line, mode.stationId) ?? 0;
    const stoppedAt =
      state.phase.kind === 'stations'
        ? state.phase.index
        : state.line.stations.length;
    if (target > stoppedAt) {
      return err(
        precondition(`${mode.stationId} is ahead of the Work order's Station`),
      );
    }
  }
  const defaulted =
    andon.reason === 'retries_exhausted' && mode.kind === 'retry_station'
      ? 1
      : undefined;
  const grantRetries = command.grantRetries ?? defaulted;
  const blobProblem = invalidIf(missingBlobs(ctx, [command.noteBlob]));
  if (blobProblem) return err(blobProblem);
  const events: OrderEvent[] = [
    {
      type: 'resumed',
      resumeId: resumeIdSchema.parse(ctx.ids.next()),
      by: by.value,
      mode,
      noteBlob: command.noteBlob,
      grantRetries,
    },
  ];
  return ok(events);
};

/** Reopens a delivered Work order at a Station, on top of the delivered commit (CORE §5.2). */
export const reopen = (
  state: WorkOrderState,
  command: CommandOf<'Reopen'>,
  ctx: DecideContext,
): Decision => {
  const by = supervisorName(ctx);
  if (!by.ok) return by;
  if (state.phase.kind !== 'delivered') {
    return err(precondition('only a delivered Work order can be reopened'));
  }
  if (state.delivery?.state === 'merged') {
    return err(precondition('the PR is merged'));
  }
  if (!findStation(state.line, command.stationId)) {
    return err(precondition(`${command.stationId} is not in the Line`));
  }
  const blobProblem = invalidIf(missingBlobs(ctx, [command.noteBlob]));
  if (blobProblem) return err(blobProblem);
  const events: OrderEvent[] = [
    {
      type: 'reopened',
      resumeId: resumeIdSchema.parse(ctx.ids.next()),
      by: by.value,
      stationId: command.stationId,
      noteBlob: command.noteBlob,
    },
  ];
  return ok(events);
};
