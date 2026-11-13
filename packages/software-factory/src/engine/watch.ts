import type { Workflow } from '../definitions/types';
import { OPERATOR_STEP, type AttemptState } from './state';

/** What the Herdr pane reports at the moment of the check. */
export interface Observation {
  agent: 'working' | 'idle' | 'blocked' | 'gone' | 'unknown';
  lastOutputAt: number;
}

export interface WatchPolicy {
  /** step timeout, measured from the attempt's start */
  timeoutMs: number;
  /** reminders sent for an idle agent before the attempt stalls */
  idleReminders: number;
  /** silence, in ms, before a working agent is nudged */
  silentMs: number;
  /** nudges sent for a silent agent before the attempt stalls */
  silentNudges: number;
}

export const DEFAULT_WATCH_TIMING = {
  idleReminders: 2,
  silentMs: 300_000,
  silentNudges: 1,
} as const;

export type WatchDecision =
  | { type: 'none' }
  | { type: 'remind'; kind: 'idle' | 'silent' }
  | { type: 'fail'; reason: 'timed_out' | 'crashed' | 'stalled' }
  | { type: 'block'; reason: 'runner_prompt' };

/** The policy for one step: its declared timeout plus the default reminder timing. */
export const watchPolicyFor = (
  workflow: Workflow,
  stepId: string,
): WatchPolicy => {
  if (stepId === OPERATOR_STEP) {
    if (workflow.operator === undefined) {
      throw new Error(`workflow "${workflow.name}" declares no operator`);
    }
    return { timeoutMs: workflow.operator.timeoutMs, ...DEFAULT_WATCH_TIMING };
  }
  const step = workflow.steps.find((candidate) => candidate.id === stepId);
  if (step === undefined) {
    throw new Error(`unknown step "${stepId}" in workflow "${workflow.name}"`);
  }
  const timeoutMs =
    step.type === 'agent'
      ? workflow.agents[step.agent]?.timeoutMs
      : step.timeoutMs;
  if (timeoutMs === undefined) {
    throw new Error(`step "${stepId}" has no timeout`);
  }
  return { timeoutMs, ...DEFAULT_WATCH_TIMING };
};

/**
 * Decides what to do with a running attempt. Time spent on an open question
 * does not count towards the timeout. Checks run in this order and the
 * first that applies wins: timeout, gone pane, blocked prompt, idle without
 * completion, then silence while working.
 */
export const watch = (
  attempt: AttemptState,
  observation: Observation,
  now: number,
  policy: WatchPolicy,
): WatchDecision => {
  const paused = attempt.pausedSince !== undefined;
  const activeSince =
    now -
    attempt.startedAt -
    attempt.pausedMs -
    (attempt.pausedSince === undefined ? 0 : now - attempt.pausedSince);
  if (activeSince >= policy.timeoutMs) {
    return { type: 'fail', reason: 'timed_out' };
  }
  if (observation.agent === 'gone') {
    return { type: 'fail', reason: 'crashed' };
  }
  // An open question parks the agent: no reminders while it waits for an answer.
  if (paused) return { type: 'none' };
  if (observation.agent === 'blocked') {
    return { type: 'block', reason: 'runner_prompt' };
  }
  if (observation.agent === 'idle') {
    if (attempt.reminders.idle < policy.idleReminders) {
      return { type: 'remind', kind: 'idle' };
    }
    return { type: 'fail', reason: 'stalled' };
  }
  if (
    observation.agent === 'working' &&
    now - observation.lastOutputAt >= policy.silentMs
  ) {
    if (attempt.reminders.silent < policy.silentNudges) {
      return { type: 'remind', kind: 'silent' };
    }
    return { type: 'fail', reason: 'stalled' };
  }
  return { type: 'none' };
};
