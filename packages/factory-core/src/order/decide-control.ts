import {
  type BlobRef,
  incidentIdSchema,
  questionIdSchema,
  resumeIdSchema,
} from '../ids';
import { findStation, stationIndex } from '../line/snapshot';
import { err, ok } from '../result';
import type { CommandOf, DecideContext } from './commands';
import {
  type Decision,
  fenced,
  invalidIf,
  mechanicName,
  missingBlobs,
  operatorName,
  precondition,
  refuseIfTerminal,
  requireActor,
  requireLive,
  runningCycle,
  stationOfCycle,
  supervisorIncident,
  supervisorName,
} from './decide-guards';
import type { IncidentAction, IncidentChange, OrderEvent } from './events';
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
  const by = operatorName(ctx);
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
  const by = operatorName(ctx);
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
  const by = operatorName(ctx);
  if (!by.ok) return by;
  // A cancelled Work order stays cancelled: an Andon raised before the cancel does not reopen it.
  const terminal = refuseIfTerminal(state);
  if (terminal) return err(terminal);
  const andon = state.andon;
  if (!andon) return err(precondition('no Andon is raised'));
  // A mechanic job works on the Andon until its incident ends the job (CORE §14.4).
  if (ctx.actor.kind !== 'mechanic' && state.activeJob?.kind === 'mechanic') {
    return err(precondition('the mechanic is working on the Andon'));
  }
  // The Mechanic clears an Andon only after it has recorded the incident for it (CORE §14.3).
  if (
    ctx.actor.kind === 'mechanic' &&
    !state.incidents.some((incident) => incident.andonAt === andon.at)
  ) {
    return err(
      precondition('the mechanic records the incident before it resumes'),
    );
  }
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
    ...supervisorIncident(state, ctx, 'resume'),
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

/** Only a repair changes files or config, and a repair names what it changed (CORE §14.2). */
const incidentShapeIssues = (
  action: IncidentAction,
  changes: IncidentChange[],
): string[] => {
  if (action.kind === 'repair' && changes.length === 0) {
    return ['a repair names the files or config it changed'];
  }
  if (action.kind !== 'repair' && changes.length > 0) {
    return [`${action.kind} changes no files or config`];
  }
  return [];
};

/**
 * The Mechanic records the incident of the open Andon before it acts on it. Exactly one incident per
 * Andon (CORE §14.2). A change ref is a commit sha or a blob; only a blob must exist in the store.
 */
export const recordIncident = (
  state: WorkOrderState,
  command: CommandOf<'RecordIncident'>,
  ctx: DecideContext,
): Decision => {
  const by = mechanicName(ctx);
  if (!by.ok) return by;
  const terminal = refuseIfTerminal(state);
  if (terminal) return err(terminal);
  const andon = state.andon;
  if (!andon) return err(precondition('no Andon is raised'));
  if (state.incidents.some((incident) => incident.andonAt === andon.at)) {
    return err(precondition('the Andon already has an incident'));
  }
  const fence = fenced(state, ctx);
  if (!fence.ok) return fence;
  if (fence.value.kind !== 'mechanic') {
    return err(precondition('only a mechanic job triages an Andon'));
  }
  const blobRefs = command.changes.map((change) =>
    change.ref.startsWith('sha256:') ? (change.ref as BlobRef) : undefined,
  );
  const invalid = invalidIf([
    ...incidentShapeIssues(command.action, command.changes),
    ...missingBlobs(ctx, blobRefs),
  ]);
  if (invalid) return err(invalid);
  const events: OrderEvent[] = [
    {
      type: 'incident_recorded',
      incidentId: incidentIdSchema.parse(ctx.ids.next()),
      by: by.value,
      andonAt: andon.at,
      andonReason: andon.reason,
      diagnosis: command.diagnosis,
      action: command.action,
      changes: command.changes,
      outcome: command.outcome,
    },
  ];
  return ok(events);
};

/**
 * The factory escalates an Andon whose Mechanic budget is spent (CORE §14.4). The escalation is an
 * incident with action `escalate`, so the Supervisor gets the Andon with its incident attached.
 */
export const escalateAndon = (
  state: WorkOrderState,
  command: CommandOf<'EscalateAndon'>,
  ctx: DecideContext,
): Decision => {
  const denied = requireActor(ctx, ['factory']);
  if (denied) return err(denied);
  const terminal = refuseIfTerminal(state);
  if (terminal) return err(terminal);
  const andon = state.andon;
  if (!andon) return err(precondition('no Andon is raised'));
  if (andon.triage === 'supervisor') {
    return err(precondition('the Andon is already with the supervisor'));
  }
  if (state.incidents.some((incident) => incident.andonAt === andon.at)) {
    return err(precondition('the Andon already has an incident'));
  }
  if (state.activeJob) {
    return err(precondition('a job holds the Work order'));
  }
  const events: OrderEvent[] = [
    {
      type: 'incident_recorded',
      incidentId: incidentIdSchema.parse(ctx.ids.next()),
      by: 'factory',
      andonAt: andon.at,
      andonReason: andon.reason,
      diagnosis: command.diagnosis,
      action: { kind: 'escalate' },
      changes: [],
      outcome: command.outcome,
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
