import type { CommitSha, CycleId, StationId } from '../ids';
import { findStation } from '../line/snapshot';
import type { CycleCause, OrderEvent, StoredEvent } from './events';
import {
  bump,
  endCycle,
  isLive,
  replaceCycle,
  requireCycle,
  requireIndex,
  resetCounter,
  stopPause,
} from './evolve-helpers';
import type {
  CycleState,
  Phase,
  QuestionRecord,
  Usage,
  WorkOrderState,
} from './state';

/** The events this module applies: everything about a Cycle or its conversation. */
export type CycleScopedEvent = Extract<
  OrderEvent,
  {
    type:
      | 'cycle_started'
      | 'cycle_completed'
      | 'verdict_recorded'
      | 'inspection_finished'
      | 'cycle_failed'
      | 'cycle_blocked'
      | 'cycle_handed_over'
      | 'usage_recorded'
      | 'question_asked'
      | 'question_answered'
      | 'question_abandoned'
      | 'note_left'
      | 'nudged';
  }
>;

const openQuestion = (state: WorkOrderState): QuestionRecord | undefined =>
  state.questions.find((question) => question.status === 'open');

const withQuestion = (
  state: WorkOrderState,
  questionId: QuestionRecord['questionId'],
  change: (question: QuestionRecord) => QuestionRecord,
): WorkOrderState => ({
  ...state,
  questions: state.questions.map((question) =>
    question.questionId === questionId ? change(question) : question,
  ),
});

/** CORE §4.3 rule 3: a Station passed; the phase moves on and the failure counters reset. */
const applyPass = (
  state: WorkOrderState,
  stationId: StationId,
  cycleId: CycleId,
  commit: CommitSha | undefined,
): WorkOrderState => {
  const index = requireIndex(state, stationId);
  const phase: Phase =
    index + 1 < state.line.stations.length
      ? { kind: 'stations', index: index + 1 }
      : { kind: 'delivering' };
  return {
    ...state,
    phase,
    lastPassed: { ...state.lastPassed, [stationId]: cycleId },
    checkpoint: commit ? { commit, afterStation: stationId } : state.checkpoint,
    restartsUsed: resetCounter(state.restartsUsed, stationId),
    lostRestartsUsed: resetCounter(state.lostRestartsUsed, stationId),
    pendingFeedback:
      state.pendingFeedback?.forStation === stationId
        ? undefined
        : state.pendingFeedback,
  };
};

/** CORE §4.3 rule 4: a judged failure asks the Station's `onFail.retry` for another Cycle. */
const applyJudgedFailure = (
  state: WorkOrderState,
  stationId: StationId,
  cycleId: CycleId,
): WorkOrderState => {
  const station = findStation(state.line, stationId);
  if (!station?.onFail) return state;
  return {
    ...state,
    pendingFeedback: { forStation: station.onFail.retry, fromCycle: cycleId },
  };
};

/** CORE §4.3 rule 5: the budget effect of a Cycle's cause. */
const applyCause = (
  state: WorkOrderState,
  stationId: StationId,
  cause: CycleCause,
): WorkOrderState => {
  switch (cause.kind) {
    case 'first':
    case 'resume':
      return state;
    case 'retry':
      return {
        ...state,
        retriesUsed: bump(
          state.retriesUsed,
          requireCycle(state, cause.feedbackFrom).stationId,
          1,
        ),
      };
    case 'restart':
      if (requireCycle(state, cause.of).outcome === 'lost') {
        return {
          ...state,
          lostRestartsUsed: bump(state.lostRestartsUsed, stationId, 1),
        };
      }
      return { ...state, restartsUsed: bump(state.restartsUsed, stationId, 1) };
    case 'handover':
      return {
        ...state,
        lostRestartsUsed: bump(state.lostRestartsUsed, stationId, 1),
      };
  }
};

const startCycle = (
  state: WorkOrderState,
  ev: Extract<OrderEvent, { type: 'cycle_started' }>,
  at: number,
): WorkOrderState => {
  const job = state.activeJob;
  if (!job || job.jobId !== ev.jobId) return state;
  const index = requireIndex(state, ev.stationId);
  const cycle: CycleState = {
    cycleId: ev.cycleId,
    jobId: ev.jobId,
    workerId: job.workerId,
    stationId: ev.stationId,
    n: ev.n,
    cause: ev.cause,
    status: 'running',
    startedAt: at,
    baseCommit: ev.baseCommit,
    artifacts: {},
    inspectionResults: [],
    pausedMs: 0,
  };
  const started: WorkOrderState = {
    ...state,
    cycles: [...state.cycles, cycle],
    phase: { kind: 'stations', index },
    workspaceFailures: [],
    pendingResume: ev.cause.kind === 'resume' ? undefined : state.pendingResume,
  };
  return applyCause(started, ev.stationId, ev.cause);
};

type CycleEndEvent = Extract<
  OrderEvent,
  {
    type:
      | 'cycle_completed'
      | 'verdict_recorded'
      | 'inspection_finished'
      | 'cycle_failed'
      | 'cycle_blocked'
      | 'cycle_handed_over';
  }
>;

/** A live Cycle ends with a non-pass outcome or a pass; either way its job ends (rule 2). */
const finishCycle = (
  state: WorkOrderState,
  ev: CycleEndEvent,
  at: number,
): WorkOrderState => {
  const stationId = requireCycle(state, ev.cycleId).stationId;
  switch (ev.type) {
    case 'cycle_completed':
      return applyPass(
        endCycle(state, ev.cycleId, at, {
          status: 'passed',
          outcome: 'done',
          commit: ev.commit,
          artifacts: ev.artifacts,
        }),
        stationId,
        ev.cycleId,
        ev.commit,
      );
    case 'verdict_recorded':
      if (ev.pass) {
        const passed = endCycle(state, ev.cycleId, at, {
          status: 'passed',
          outcome: 'verdict_pass',
          artifacts: ev.artifacts,
          commit: ev.commit,
        });
        return applyPass(passed, stationId, ev.cycleId, ev.commit);
      }
      return applyJudgedFailure(
        endCycle(state, ev.cycleId, at, {
          status: 'failed',
          outcome: 'verdict_fail',
          artifacts: ev.artifacts,
          feedbackBlob: ev.feedbackBlob,
          commit: ev.commit,
        }),
        stationId,
        ev.cycleId,
      );
    case 'inspection_finished':
      if (ev.passed) {
        const passed = endCycle(state, ev.cycleId, at, {
          status: 'passed',
          outcome: 'inspection_pass',
          inspectionResults: ev.results,
        });
        return applyPass(passed, stationId, ev.cycleId, undefined);
      }
      return applyJudgedFailure(
        endCycle(state, ev.cycleId, at, {
          status: 'failed',
          outcome: 'inspection_fail',
          inspectionResults: ev.results,
        }),
        stationId,
        ev.cycleId,
      );
    case 'cycle_failed':
      return endCycle(state, ev.cycleId, at, {
        status: 'failed',
        outcome: ev.reason,
      });
    case 'cycle_blocked':
      return endCycle(state, ev.cycleId, at, {
        status: 'blocked',
        outcome: 'blocked',
        handoverBlob: ev.handoverBlob,
        commit: ev.commit,
      });
    case 'cycle_handed_over':
      return endCycle(state, ev.cycleId, at, {
        status: 'handed_over',
        outcome: 'handed_over',
        handoverBlob: ev.handoverBlob,
        commit: ev.commit,
      });
    default:
      return state;
  }
};

/** A question is asked on a live Cycle: the Cycle pauses until the question is answered or the Cycle ends. */
const askQuestion = (
  state: WorkOrderState,
  ev: Extract<OrderEvent, { type: 'question_asked' }>,
  at: number,
): WorkOrderState => {
  if (!isLive(state, ev.cycleId) || openQuestion(state)) return state;
  const record: QuestionRecord = {
    questionId: ev.questionId,
    cycleId: ev.cycleId,
    text: ev.text,
    status: 'open',
    askedAt: at,
  };
  const paused = replaceCycle(state, ev.cycleId, (cycle) => ({
    ...cycle,
    pausedSince: at,
  }));
  return { ...paused, questions: [...paused.questions, record] };
};

/**
 * An answer updates the question whatever the asking Cycle's status (rule 1 exception). Only a
 * question still open on a live Cycle stops that Cycle's pause.
 */
const answerQuestion = (
  state: WorkOrderState,
  ev: Extract<OrderEvent, { type: 'question_answered' }>,
  at: number,
): WorkOrderState => {
  const record = state.questions.find(
    (question) => question.questionId === ev.questionId,
  );
  if (!record) return state;
  const wasOpen = record.status === 'open';
  const answered = withQuestion(state, ev.questionId, (question) => ({
    ...question,
    status: 'answered',
    answer: { by: ev.by, text: ev.text, at },
  }));
  if (!wasOpen || !isLive(answered, record.cycleId)) return answered;
  return replaceCycle(answered, record.cycleId, (cycle) =>
    stopPause(cycle, at),
  );
};

const usageOf = (
  ev: Extract<OrderEvent, { type: 'usage_recorded' }>,
): Usage => ({
  model: ev.model,
  inputTokens: ev.inputTokens,
  outputTokens: ev.outputTokens,
  costUsd: ev.costUsd,
});

/** Applies one event about a Cycle or its conversation (CORE §4.3 rules 1, 3-6). */
export const evolveCycleEvent = (
  state: WorkOrderState,
  stored: StoredEvent,
  ev: CycleScopedEvent,
): WorkOrderState => {
  const at = stored.at;
  switch (ev.type) {
    case 'cycle_started':
      return startCycle(state, ev, at);
    case 'usage_recorded':
      // Accepted whatever the Cycle's status (rule 1 exception). A late fact about an unknown Cycle is inert.
      if (!state.cycles.some((cycle) => cycle.cycleId === ev.cycleId))
        return state;
      return replaceCycle(state, ev.cycleId, (cycle) => ({
        ...cycle,
        usage: usageOf(ev),
      }));
    case 'question_asked':
      return askQuestion(state, ev, at);
    case 'question_answered':
      return answerQuestion(state, ev, at);
    case 'question_abandoned':
      return withQuestion(state, ev.questionId, (question) =>
        question.status === 'open'
          ? { ...question, status: 'abandoned' }
          : question,
      );
    case 'nudged':
      // Recorded for the audit view; it changes nothing the Factory decides on.
      return state;
    case 'note_left': {
      if (!isLive(state, ev.cycleId)) return state;
      const stationId = requireCycle(state, ev.cycleId).stationId;
      return {
        ...state,
        notes: [
          ...state.notes,
          {
            cycleId: ev.cycleId,
            fromStation: stationId,
            to: ev.to,
            text: ev.text,
          },
        ],
      };
    }
    default:
      return isLive(state, ev.cycleId) ? finishCycle(state, ev, at) : state;
  }
};
