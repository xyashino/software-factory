import type { InputRef, Workflow } from '../definitions/types';
import type { GateFailure } from './events';
import type { TaskState } from './state';

export type ResolvedInput =
  | {
      kind: 'artifact';
      stepId: string;
      artifactKey: string;
      /** the passing attempt that produced it; undefined if none has passed yet */
      attemptId: string | undefined;
      /** absolute path of the artifact; undefined if none has passed yet */
      path: string | undefined;
    }
  | { kind: 'task'; field: string; value: string | undefined }
  | {
      kind: 'gate';
      stepId: string;
      /** the passing attempt of the gate; undefined if none has passed yet */
      attemptId: string | undefined;
      /** the commands the gate ran; a pass means each exited 0 */
      commands: string[];
    };

export type FeedbackContext =
  | { kind: 'verdict'; fromAttempt: string; feedbackPath: string | undefined }
  | { kind: 'gate'; fromAttempt: string; failures: GateFailure[] };

export interface AttemptContext {
  inputs: ResolvedInput[];
  /** notes earlier steps left for this one, in the order they were written */
  notes: { fromStep: string; text: string }[];
  feedback: FeedbackContext | undefined;
}

/**
 * What a new attempt of `stepId` receives: the input artifacts of the last
 * passing attempts, and the feedback of the failure it is fixing, if any.
 * Rendering the text is the prompt layer's job; this only says what goes in.
 */
export const resolveAttemptContext = (
  workflow: Workflow,
  state: TaskState,
  stepId: string,
): AttemptContext => {
  const step = workflow.steps.find((candidate) => candidate.id === stepId);
  if (step === undefined) {
    throw new Error(`unknown step "${stepId}" in workflow "${workflow.name}"`);
  }
  const inputRefs: InputRef[] = step.type === 'agent' ? step.inputs : [];

  return {
    inputs: inputRefs.map((ref) => resolveInput(workflow, state, ref)),
    notes: state.notes
      .filter((note) => note.toStep === stepId)
      .map((note) => ({ fromStep: note.fromStep, text: note.text })),
    feedback: resolveFeedback(workflow, state, stepId),
  };
};

const resolveInput = (
  workflow: Workflow,
  state: TaskState,
  ref: InputRef,
): ResolvedInput => {
  if ('source' in ref && ref.source === 'gate') {
    const gate = workflow.steps.find((step) => step.id === ref.stepId);
    return {
      kind: 'gate',
      stepId: ref.stepId,
      attemptId: state.lastPassed[ref.stepId],
      commands: gate?.type === 'commands' ? gate.exec : [],
    };
  }
  if ('source' in ref) {
    return {
      kind: 'task',
      field: ref.field,
      value: taskField(state, ref.field),
    };
  }
  const attemptId = state.lastPassed[ref.stepId];
  const attempt = state.attempts.find(
    (candidate) => candidate.attemptId === attemptId,
  );
  return {
    kind: 'artifact',
    stepId: ref.stepId,
    artifactKey: ref.artifactKey,
    attemptId,
    path: attempt?.artifacts[ref.artifactKey],
  };
};

const taskField = (state: TaskState, field: string): string | undefined => {
  if (state.task === undefined) return undefined;
  switch (field) {
    case 'workflow':
      return state.task.workflow;
    case 'todoPath':
      return state.task.todoPath;
    case 'branch':
      return state.task.branch;
    default:
      return undefined;
  }
};

const resolveFeedback = (
  workflow: Workflow,
  state: TaskState,
  stepId: string,
): FeedbackContext | undefined => {
  const fromAttemptId = feedbackSource(state, stepId);
  if (fromAttemptId === undefined) return undefined;

  const failed = state.attempts.find(
    (attempt) => attempt.attemptId === fromAttemptId,
  );
  if (failed === undefined) return undefined;

  const failedStep = workflow.steps.find((step) => step.id === failed.stepId);
  if (failedStep?.type === 'commands') {
    return {
      kind: 'gate',
      fromAttempt: failed.attemptId,
      failures: failed.failures,
    };
  }
  return {
    kind: 'verdict',
    fromAttempt: failed.attemptId,
    feedbackPath: failed.feedbackPath,
  };
};

/** The in-flight attempt's own feedback link, or the pending one not yet started. */
const feedbackSource = (
  state: TaskState,
  stepId: string,
): string | undefined => {
  const current = state.current;
  if (
    current !== undefined &&
    current.stepId === stepId &&
    (current.status === 'starting' || current.status === 'running') &&
    current.feedbackFrom !== undefined
  ) {
    return current.feedbackFrom;
  }
  if (state.pendingFeedback?.forStep === stepId) {
    return state.pendingFeedback.fromAttempt;
  }
  return undefined;
};
