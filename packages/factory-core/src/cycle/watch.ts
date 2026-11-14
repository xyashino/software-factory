/** What the Operator's pane reports at the moment of the check (CORE §9.1). */
export interface Observation {
  operator: 'working' | 'idle' | 'blocked' | 'gone' | 'unknown';
  lastOutputAt: number;
}

/** The runtime view of one running Cycle: when it started and how long it was held. */
export interface RuntimeCycle {
  startedAt: number;
  pausedMs: number;
  pausedSince?: number;
  reminders: { idle: number; silent: number };
}

export interface WatchPolicy {
  /** Cycle timeout, measured from its start, with paused time not counted. */
  timeoutMs: number;
  /** Reminders sent for an idle Operator before the Cycle stalls. */
  idleReminders: number;
  /** Silence, in ms, before a working Operator is reminded. */
  silentMs: number;
  /** Reminders sent for a silent Operator before the Cycle stalls. */
  silentNudges: number;
}

export type WatchDecision =
  | { type: 'none' }
  | { type: 'remind'; kind: 'idle' | 'silent' }
  | { type: 'fail'; reason: 'timed_out' | 'crashed' | 'stalled' }
  | { type: 'block'; reason: 'runner_prompt' };

/** Time the Cycle has been active: elapsed minus held time, the open hold included. */
const activeMs = (cycle: RuntimeCycle, now: number): number => {
  const openHold =
    cycle.pausedSince === undefined ? 0 : now - cycle.pausedSince;
  return now - cycle.startedAt - cycle.pausedMs - openHold;
};

/**
 * Decides what to do with a running Cycle. Time spent on an open question does not count towards
 * the timeout. Checks run in this order and the first that applies wins: timeout, gone pane,
 * held question (no reminders), blocked prompt, idle without completion, then silence while
 * working.
 */
export const watch = (
  cycle: RuntimeCycle,
  observation: Observation,
  now: number,
  policy: WatchPolicy,
): WatchDecision => {
  if (activeMs(cycle, now) >= policy.timeoutMs) {
    return { type: 'fail', reason: 'timed_out' };
  }
  if (observation.operator === 'gone') {
    return { type: 'fail', reason: 'crashed' };
  }
  if (cycle.pausedSince !== undefined) return { type: 'none' };
  if (observation.operator === 'blocked') {
    return { type: 'block', reason: 'runner_prompt' };
  }
  if (observation.operator === 'idle') {
    if (cycle.reminders.idle < policy.idleReminders) {
      return { type: 'remind', kind: 'idle' };
    }
    return { type: 'fail', reason: 'stalled' };
  }
  if (
    observation.operator === 'working' &&
    now - observation.lastOutputAt >= policy.silentMs
  ) {
    if (cycle.reminders.silent < policy.silentNudges) {
      return { type: 'remind', kind: 'silent' };
    }
    return { type: 'fail', reason: 'stalled' };
  }
  return { type: 'none' };
};
