import type { Workflow } from '../definitions/types';
import type { SupervisorAction } from './actions';
import type { AttemptState, TaskState } from './state';

/**
 * The decision table, evaluated top to bottom; the first matching row wins.
 * Pure: the same workflow and state always return the same action.
 */
export const nextAction = (
  workflow: Workflow,
  state: TaskState,
): SupervisorAction => {
  if (state.delivered !== undefined) return { type: 'idle' };
  if (state.task === undefined) {
    return { type: 'idle' };
  }
  if (state.setupOk === undefined) {
    return state.block === undefined ? { type: 'setup' } : { type: 'idle' };
  }
  if (state.setupOk === false) {
    return state.block?.reason === 'setup_failed'
      ? { type: 'idle' }
      : {
          type: 'block',
          reason: 'setup_failed',
          detail: 'workflow setup command failed',
        };
  }
  // A blocked pane would refuse the prompt again; the unblock delivers it.
  const prompt =
    state.block !== undefined
      ? undefined
      : state.pendingPrompts.find((pending) =>
          isLive(state, pending.attemptId),
        );
  if (prompt !== undefined) {
    return {
      type: 'deliver_prompt',
      attemptId: prompt.attemptId,
      kind: prompt.kind,
      text: prompt.text,
      ...(prompt.keys === undefined ? {} : { keys: prompt.keys }),
      ...(prompt.question === undefined ? {} : { question: prompt.question }),
    };
  }
  const operator = state.operator;
  if (operator !== undefined) {
    if (operator.status === 'starting' || operator.status === 'running') {
      return { type: 'watch', attemptId: operator.attemptId };
    }
    // An ended operator attempt is inspected once before the line moves again.
    if (!state.operatorChecked) {
      return { type: 'watch', attemptId: operator.attemptId };
    }
  }
  if (state.escalation !== undefined) {
    return {
      type: 'block',
      reason: state.block?.reason ?? 'question',
      detail: state.escalation,
    };
  }
  if (state.block !== undefined) return operatorFor(workflow, state);
  if (state.openQuestion !== undefined) return operatorFor(workflow, state);
  if (state.status === 'delivering') {
    return { type: 'deliver', to: workflow.deliver.to };
  }

  const current = state.current;
  if (current === undefined) {
    return startNext(workflow, state);
  }

  switch (current.status) {
    case 'starting':
    case 'running':
      // A headless run has no pane to observe; its process reports its own end.
      return isHeadless(workflow, current.stepId)
        ? { type: 'idle' }
        : { type: 'watch', attemptId: current.attemptId };
    case 'completed':
    case 'passed':
      return startNext(workflow, state);
    case 'failed':
      return afterFailure(workflow, state, current);
  }
};

const isHeadless = (workflow: Workflow, stepId: string): boolean => {
  const step = workflow.steps.find((candidate) => candidate.id === stepId);
  return (
    step?.type === 'agent' && workflow.agents[step.agent]?.headless === true
  );
};

const isLive = (state: TaskState, attemptId: string): boolean => {
  const attempt = [...state.attempts, state.operator].find(
    (candidate) => candidate?.attemptId === attemptId,
  );
  return attempt?.status === 'starting' || attempt?.status === 'running';
};

/**
 * An incident the on-call operator may triage: it starts at most once per
 * incident, and never for setup or delivery failures or a question to a human.
 * Otherwise the task waits for a human.
 */
const operatorFor = (
  workflow: Workflow,
  state: TaskState,
): SupervisorAction => {
  if (workflow.operator === undefined || state.operatorRan) {
    return { type: 'idle' };
  }
  const block = state.block;
  if (block !== undefined) {
    const reason = block.reason;
    if (reason === 'infra' || reason === 'runner_prompt') {
      return { type: 'start_operator', reason, detail: block.detail };
    }
    if (reason === 'retries_exhausted' && state.extraRetry === undefined) {
      return { type: 'start_operator', reason, detail: block.detail };
    }
    return { type: 'idle' };
  }
  const question = state.openQuestion;
  if (question?.to === 'operator') {
    return {
      type: 'start_operator',
      reason: 'question',
      detail: question.text,
      questionId: question.questionId,
    };
  }
  return { type: 'idle' };
};

/** The cursor already points at the next step; past the last one, deliver. */
const startNext = (workflow: Workflow, state: TaskState): SupervisorAction => {
  const step = workflow.steps[state.cursor];
  if (step === undefined) {
    return { type: 'deliver', to: workflow.deliver.to };
  }
  return { type: 'start_attempt', stepId: step.id, n: nextN(state, step.id) };
};

const afterFailure = (
  workflow: Workflow,
  state: TaskState,
  failed: AttemptState,
): SupervisorAction => {
  switch (failed.outcome) {
    case 'verdict_fail':
    case 'gate_fail':
      return afterJudgeOrGateFailure(workflow, state, failed);
    case 'timed_out':
    case 'crashed':
    case 'stalled':
    case 'start_failed':
      return afterInfraFailure(state, failed);
    default:
      return {
        type: 'block',
        reason: 'infra',
        detail: `attempt ${failed.attemptId} failed without an outcome`,
      };
  }
};

const afterJudgeOrGateFailure = (
  workflow: Workflow,
  state: TaskState,
  failed: AttemptState,
): SupervisorAction => {
  const step = workflow.steps.find(
    (candidate) => candidate.id === failed.stepId,
  );
  if (step?.onFail === undefined) {
    return {
      type: 'block',
      reason: 'no_retry',
      detail: `step ${failed.stepId} failed and declares no retry`,
    };
  }
  const used = state.retriesUsed[failed.stepId] ?? 0;
  const extra = state.extraRetry?.stepId === failed.stepId ? 1 : 0;
  if (used >= step.onFail.max + extra) {
    return {
      type: 'block',
      reason: 'retries_exhausted',
      detail: `step ${failed.stepId} failed ${used + 1} times; budget is ${step.onFail.max}`,
    };
  }
  return {
    type: 'start_attempt',
    stepId: step.onFail.retry,
    n: nextN(state, step.onFail.retry),
    feedbackFrom: failed.attemptId,
  };
};

const afterInfraFailure = (
  state: TaskState,
  failed: AttemptState,
): SupervisorAction => {
  // A restart that failed again waits for a human; a human's extra start lets it run once more.
  if (
    failed.restartOf !== undefined &&
    state.extraRetry?.stepId !== failed.stepId
  ) {
    return {
      type: 'block',
      reason: 'infra',
      detail: `attempt ${failed.attemptId} failed again after a restart`,
    };
  }
  const restart: SupervisorAction = {
    type: 'start_attempt',
    stepId: failed.stepId,
    n: nextN(state, failed.stepId),
    restartOf: failed.attemptId,
    restoreSnapshot: failed.snapshotRef,
  };
  if (failed.feedbackFrom !== undefined) {
    return { ...restart, feedbackFrom: failed.feedbackFrom };
  }
  return restart;
};

/** `n` of the next attempt of a step: every earlier attempt of that step counts. */
const nextN = (state: TaskState, stepId: string): number => {
  return (
    state.attempts.filter((attempt) => attempt.stepId === stepId).length + 1
  );
};
