import type { Workflow } from '../definitions/types';
import type { TimedEvent, FactoryEvent } from './events';
import { OPERATOR_STEP, type AttemptState, type TaskState } from './state';

/**
 * Left fold of the event history into the task state. Pure: the same workflow
 * and events always produce the same state.
 *
 * Events that refer to an attempt which is not the live (latest, still running)
 * attempt are ignored, so a late `completed` after a timeout cannot move the task.
 */
export const reduce = (
  workflow: Workflow,
  events: readonly TimedEvent[],
): TaskState => {
  const state: TaskState = {
    status: 'setting_up',
    task: undefined,
    setupOk: undefined,
    cursor: 0,
    attempts: [],
    current: undefined,
    retriesUsed: {},
    pendingFeedback: undefined,
    lastPassed: {},
    openQuestion: undefined,
    notes: [],
    operator: undefined,
    operatorRan: false,
    operatorChecked: false,
    extraRetry: undefined,
    pendingPrompts: [],
    escalation: undefined,
    block: undefined,
    deliveryStarted: false,
    delivered: undefined,
    blockedPr: undefined,
    parked: false,
  };

  for (const { at, event } of events) {
    apply(state, workflow, at, event);
    state.current = state.attempts.at(-1);
  }

  state.status = deriveStatus(state);
  return state;
};

const apply = (
  state: TaskState,
  workflow: Workflow,
  at: number,
  event: FactoryEvent,
): void => {
  switch (event.type) {
    case 'task_created':
      state.task = {
        workflow: event.workflow,
        todoPath: event.todoPath,
        branch: event.branch,
      };
      return;
    case 'setup_started':
      return;
    case 'setup_finished':
      state.setupOk = event.ok;
      return;
    case 'attempt_started':
      startAttempt(state, workflow, at, event);
      return;
    case 'agent_ready': {
      const attempt = liveAttempt(state, event.attemptId);
      if (attempt?.status === 'starting') {
        attempt.status = 'running';
      }
      return;
    }
    case 'completed': {
      const attempt = liveAttempt(state, event.attemptId);
      if (attempt === undefined) return;
      attempt.status = 'completed';
      attempt.outcome = 'done';
      // The operator is outside the assembly line: it never advances the cursor.
      if (attempt !== state.operator) pass(state, workflow, attempt);
      return;
    }
    case 'verdict': {
      const attempt = liveAttempt(state, event.attemptId);
      if (attempt === undefined) return;
      if (event.pass) {
        attempt.status = 'passed';
        attempt.outcome = 'verdict_pass';
        pass(state, workflow, attempt);
      } else {
        attempt.status = 'failed';
        attempt.outcome = 'verdict_fail';
        if (event.feedbackPath !== undefined) {
          attempt.feedbackPath = event.feedbackPath;
        }
        failPending(state, workflow, attempt);
      }
      return;
    }
    case 'gate_finished': {
      const attempt = liveAttempt(state, event.attemptId);
      if (attempt === undefined) return;
      if (event.passed) {
        attempt.status = 'passed';
        attempt.outcome = 'gate_pass';
        pass(state, workflow, attempt);
      } else {
        attempt.status = 'failed';
        attempt.outcome = 'gate_fail';
        attempt.failures = event.failures;
        failPending(state, workflow, attempt);
      }
      return;
    }
    case 'attempt_failed': {
      const attempt = liveAttempt(state, event.attemptId);
      if (attempt === undefined) return;
      attempt.status = 'failed';
      attempt.outcome = event.reason;
      return;
    }
    case 'usage_recorded': {
      // Usage arrives after the process exits, so the attempt is usually no longer live.
      const attempt = [...state.attempts, state.operator].find(
        (candidate) => candidate?.attemptId === event.attemptId,
      );
      if (attempt === undefined) return;
      attempt.usage = {
        model: event.model,
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
        ...(event.costUsd === undefined ? {} : { costUsd: event.costUsd }),
      };
      return;
    }
    case 'reminder_sent': {
      const attempt = liveAttempt(state, event.attemptId);
      if (attempt !== undefined) {
        attempt.reminders[event.kind] += 1;
      }
      return;
    }
    case 'question_asked': {
      const attempt = liveAttempt(state, event.attemptId);
      if (attempt === undefined || attempt === state.operator) return;
      state.openQuestion = {
        questionId: event.questionId,
        to: event.to,
        attemptId: event.attemptId,
        text: event.text,
        askedAt: at,
      };
      attempt.pausedSince ??= at;
      state.operatorRan = false;
      return;
    }
    case 'answered': {
      const question = state.openQuestion;
      if (question?.questionId !== event.questionId) return;
      state.openQuestion = undefined;
      const asker = state.attempts.find(
        (attempt) => attempt.attemptId === question.attemptId,
      );
      if (asker?.pausedSince !== undefined) {
        asker.pausedMs += at - asker.pausedSince;
        delete asker.pausedSince;
      }
      state.pendingPrompts.push({
        attemptId: question.attemptId,
        kind: 'answer',
        text: event.text,
        question: question.text,
      });
      return;
    }
    case 'note': {
      const attempt = liveAttempt(state, event.attemptId);
      if (attempt === undefined || attempt === state.operator) return;
      state.notes.push({
        fromAttempt: attempt.attemptId,
        fromStep: attempt.stepId,
        toStep: event.to,
        text: event.text,
      });
      return;
    }
    case 'blocked':
      state.block = { reason: event.reason, detail: event.detail };
      state.escalation = undefined;
      return;
    case 'unblocked': {
      state.block = undefined;
      state.parked = false;
      state.blockedPr = undefined;
      if (event.by !== 'operator') {
        state.operatorRan = false;
      }
      state.escalation = undefined;
      if (event.extraRetry === true && state.current !== undefined) {
        state.extraRetry = { stepId: state.current.stepId };
      }
      if (event.nudge !== undefined) {
        const target = promptTarget(state);
        if (target !== undefined) {
          state.pendingPrompts.push({
            attemptId: target.attemptId,
            kind: 'nudge',
            text: event.nudge,
          });
        }
      }
      if (event.keys !== undefined) {
        const target = promptTarget(state);
        if (target !== undefined) {
          state.pendingPrompts.push({
            attemptId: target.attemptId,
            kind: 'keys',
            text: '',
            keys: event.keys,
          });
        }
      }
      return;
    }
    case 'escalated':
      state.escalation = event.text;
      return;
    case 'prompt_delivered': {
      const index = state.pendingPrompts.findIndex(
        (prompt) =>
          prompt.attemptId === event.attemptId && prompt.kind === event.kind,
      );
      if (index !== -1) state.pendingPrompts.splice(index, 1);
      return;
    }
    case 'operator_checked':
      if (state.operator?.attemptId === event.attemptId) {
        state.operatorChecked = true;
      }
      return;
    case 'delivery_started':
      state.deliveryStarted = true;
      return;
    case 'delivered':
      state.delivered = { prUrl: event.prUrl };
      return;
    case 'delivered_blocked':
      state.blockedPr = { prUrl: event.prUrl };
      return;
    case 'parked':
      state.parked = true;
      return;
    case 'delivery_failed':
      state.block = { reason: 'delivery_failed', detail: event.detail };
      return;
  }
};

const startAttempt = (
  state: TaskState,
  workflow: Workflow,
  at: number,
  event: Extract<FactoryEvent, { type: 'attempt_started' }>,
): void => {
  // A restart that runs on a human's extra start uses that grant up.
  if (
    event.restartOf !== undefined &&
    state.extraRetry?.stepId === event.stepId
  ) {
    state.extraRetry = undefined;
  }
  // A retry (not an infrastructure restart) consumes one unit of the failing step's budget.
  if (event.feedbackFrom !== undefined && event.restartOf === undefined) {
    const failing = state.attempts.find(
      (attempt) => attempt.attemptId === event.feedbackFrom,
    );
    if (failing !== undefined) {
      state.retriesUsed[failing.stepId] =
        (state.retriesUsed[failing.stepId] ?? 0) + 1;
    }
  }

  const attempt: AttemptState = {
    pausedMs: 0,
    attemptId: event.attemptId,
    stepId: event.stepId,
    n: event.n,
    status: 'starting',
    startedAt: at,
    reminders: { idle: 0, silent: 0 },
    snapshotRef: event.snapshotRef,
    artifacts: event.artifacts,
    failures: [],
  };
  if (event.restartOf !== undefined) attempt.restartOf = event.restartOf;
  if (event.feedbackFrom !== undefined) {
    attempt.feedbackFrom = event.feedbackFrom;
  }
  if (event.stepId === OPERATOR_STEP) {
    state.operator = attempt;
    state.operatorRan = true;
    state.operatorChecked = false;
    return;
  }
  state.attempts.push(attempt);

  const index = stepIndex(workflow, event.stepId);
  if (index !== -1) state.cursor = index;
  if (state.pendingFeedback?.forStep === event.stepId) {
    state.pendingFeedback = undefined;
  }
};

/** Advance past a passing attempt and record its artifacts as current. */
const pass = (
  state: TaskState,
  workflow: Workflow,
  attempt: AttemptState,
): void => {
  state.operatorRan = false;
  state.lastPassed[attempt.stepId] = attempt.attemptId;
  const index = stepIndex(workflow, attempt.stepId);
  state.cursor = index === -1 ? state.cursor : index + 1;
};

/** Record which step must receive this failure's feedback, if the step declares a retry. */
const failPending = (
  state: TaskState,
  workflow: Workflow,
  attempt: AttemptState,
): void => {
  const step = workflow.steps.find(
    (candidate) => candidate.id === attempt.stepId,
  );
  if (step?.onFail !== undefined) {
    state.pendingFeedback = {
      forStep: step.onFail.retry,
      fromAttempt: attempt.attemptId,
    };
  }
};

/** The agent that must receive a nudge: the live assembly-line attempt, else the live operator. */
const promptTarget = (state: TaskState): AttemptState | undefined => {
  const candidates = [state.attempts.at(-1), state.operator];
  return candidates.find(
    (attempt) =>
      attempt !== undefined &&
      (attempt.status === 'starting' || attempt.status === 'running'),
  );
};

/** The attempt only if it is the latest one (or the operator) and still in flight. */
const liveAttempt = (
  state: TaskState,
  attemptId: string,
): AttemptState | undefined => {
  const operator = state.operator;
  if (
    operator?.attemptId === attemptId &&
    (operator.status === 'starting' || operator.status === 'running')
  ) {
    return operator;
  }
  const latest = state.attempts.at(-1);
  if (latest === undefined || latest.attemptId !== attemptId) return undefined;
  if (latest.status !== 'starting' && latest.status !== 'running') {
    return undefined;
  }
  return latest;
};

const stepIndex = (workflow: Workflow, stepId: string): number => {
  return workflow.steps.findIndex((step) => step.id === stepId);
};

const deriveStatus = (state: TaskState): TaskState['status'] => {
  if (state.delivered !== undefined) return 'delivered';
  if (state.block !== undefined) {
    return state.blockedPr !== undefined || state.parked ? 'parked' : 'blocked';
  }
  if (state.deliveryStarted) return 'delivering';
  if (state.task === undefined || state.setupOk === undefined) {
    return 'setting_up';
  }
  if (state.openQuestion !== undefined) return 'waiting';
  return 'running';
};
