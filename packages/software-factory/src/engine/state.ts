import type { BlockReason, GateFailure } from './events';

/** The step id the on-call operator's attempts carry; not a step of any workflow. */
export const OPERATOR_STEP = 'operator';

export type AttemptStatus =
  'starting' | 'running' | 'completed' | 'passed' | 'failed';

export type AttemptOutcome =
  | 'done'
  | 'verdict_pass'
  | 'verdict_fail'
  | 'gate_pass'
  | 'gate_fail'
  | 'timed_out'
  | 'crashed'
  | 'stalled'
  | 'start_failed';

/** What a headless runner reported for one attempt. */
export interface AttemptUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd?: number;
}

export interface AttemptState {
  attemptId: string;
  stepId: string;
  /** counts every attempt of this step in the task, starting at 1 */
  n: number;
  status: AttemptStatus;
  outcome?: AttemptOutcome;
  startedAt: number;
  reminders: { idle: number; silent: number };
  restartOf?: string;
  feedbackFrom?: string;
  snapshotRef: string;
  /** artifact key -> absolute path */
  artifacts: Record<string, string>;
  /** judge feedback file, set by a failing verdict */
  feedbackPath?: string;
  /** gate failures, set by a failing gate */
  failures: GateFailure[];
  /** time spent waiting on answered questions; excluded from the timeout */
  pausedMs: number;
  /** set while a question of this attempt is open */
  pausedSince?: number;
  /** set by `usage_recorded`; absent for pane attempts */
  usage?: AttemptUsage;
}

export interface OpenQuestion {
  questionId: string;
  to: 'operator' | 'human';
  attemptId: string;
  text: string;
  askedAt: number;
}

/** A note an earlier step left for a later one. */
export interface StepNote {
  fromAttempt: string;
  fromStep: string;
  /** a step id or `human` */
  toStep: string;
  text: string;
}

/** Text the supervisor must still type into an agent pane. */
export interface PendingPrompt {
  attemptId: string;
  kind: 'answer' | 'nudge' | 'keys';
  text: string;
  /** key presses to send instead of text (kind `keys`) */
  keys?: string[];
  /** the question an answer replies to */
  question?: string;
}

export const TASK_STATUSES = [
  'setting_up',
  'running',
  'waiting',
  'blocked',
  'parked',
  'queued',
  'delivering',
  'delivered',
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface TaskInfo {
  workflow: string;
  todoPath: string;
  branch: string;
}

/** Everything `reduce` derives from the event history. */
export interface TaskState {
  status: TaskStatus;
  task: TaskInfo | undefined;
  /** undefined until `setup_finished` */
  setupOk: boolean | undefined;
  /** index into workflow.steps of the step to run next */
  cursor: number;
  /** every attempt in start order */
  attempts: AttemptState[];
  /** the latest attempt, whatever its status */
  current: AttemptState | undefined;
  /** lifetime count of retries consumed, keyed by the failing step; never reset */
  retriesUsed: Record<string, number>;
  /** the failure whose feedback the next attempt of `forStep` must receive */
  pendingFeedback: { forStep: string; fromAttempt: string } | undefined;
  /** stepId -> attemptId whose artifacts are current */
  lastPassed: Record<string, string>;
  openQuestion: OpenQuestion | undefined;
  notes: StepNote[];
  /** the on-call operator attempt; never part of `attempts`, `current` or `cursor` */
  operator: AttemptState | undefined;
  /** the operator already ran for this incident; reset by `unblocked` and `question_asked` */
  operatorRan: boolean;
  /** the supervisor inspected the worktree after the operator attempt ended */
  operatorChecked: boolean;
  /** the step that received its one extra retry; undefined until granted */
  extraRetry: { stepId: string } | undefined;
  pendingPrompts: PendingPrompt[];
  /** hand-over text; the engine turns it into one final `block` */
  escalation: string | undefined;
  block: { reason: BlockReason; detail: string } | undefined;
  deliveryStarted: boolean;
  delivered: { prUrl: string } | undefined;
  /** draft `[BLOCKED]` PR that preserves the work of a blocked task */
  blockedPr: { prUrl: string } | undefined;
  /** the block is final and the line is released; reset by `unblocked` */
  parked: boolean;
}
