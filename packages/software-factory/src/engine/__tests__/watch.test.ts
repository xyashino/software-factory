import { describe, expect, it } from 'vitest';
import type { AttemptState } from '../state';
import { loadWorkflow } from './harness';
import {
  watch,
  watchPolicyFor,
  type Observation,
  type WatchPolicy,
} from '../watch';

const policy: WatchPolicy = {
  timeoutMs: 60_000,
  idleReminders: 2,
  silentMs: 10_000,
  silentNudges: 1,
};

const attempt = (overrides: Partial<AttemptState> = {}): AttemptState => {
  return {
    attemptId: 'build-1',
    stepId: 'build',
    n: 1,
    status: 'running',
    startedAt: 0,
    reminders: { idle: 0, silent: 0 },
    snapshotRef: 'snap',
    artifacts: {},
    failures: [],
    pausedMs: 0,
    ...overrides,
  };
};

const observe = (
  agent: Observation['agent'],
  lastOutputAt = 0,
): Observation => {
  return { agent, lastOutputAt };
};

describe('watch', () => {
  it('does nothing for a healthy working agent', () => {
    expect(watch(attempt(), observe('working', 5_000), 6_000, policy)).toEqual({
      type: 'none',
    });
  });

  describe('precedence', () => {
    it('times out before anything else is considered', () => {
      const decision = watch(attempt(), observe('gone'), 60_000, policy);
      expect(decision).toEqual({ type: 'fail', reason: 'timed_out' });
    });

    it('reports a crash when the pane is gone', () => {
      expect(watch(attempt(), observe('gone'), 1_000, policy)).toEqual({
        type: 'fail',
        reason: 'crashed',
      });
    });

    it('blocks on a runner prompt before reminding idle agents', () => {
      expect(watch(attempt(), observe('blocked'), 1_000, policy)).toEqual({
        type: 'block',
        reason: 'runner_prompt',
      });
    });

    it('checks idleness before silence', () => {
      const decision = watch(attempt(), observe('idle', 0), 20_000, policy);
      expect(decision).toEqual({ type: 'remind', kind: 'idle' });
    });
  });

  describe('timeout boundary', () => {
    it('does not time out one millisecond before the limit', () => {
      expect(
        watch(attempt(), observe('working', 59_999), 59_999, policy),
      ).toEqual({ type: 'none' });
    });

    it('times out exactly at the limit', () => {
      expect(
        watch(attempt(), observe('working', 59_999), 60_000, policy),
      ).toEqual({
        type: 'fail',
        reason: 'timed_out',
      });
    });
  });

  describe('idle agent', () => {
    it('reminds until the reminder limit is reached', () => {
      expect(
        watch(
          attempt({ reminders: { idle: 0, silent: 0 } }),
          observe('idle'),
          1_000,
          policy,
        ),
      ).toEqual({
        type: 'remind',
        kind: 'idle',
      });
      expect(
        watch(
          attempt({ reminders: { idle: 1, silent: 0 } }),
          observe('idle'),
          1_000,
          policy,
        ),
      ).toEqual({
        type: 'remind',
        kind: 'idle',
      });
    });

    it('stalls after the second unheeded reminder', () => {
      expect(
        watch(
          attempt({ reminders: { idle: 2, silent: 0 } }),
          observe('idle'),
          1_000,
          policy,
        ),
      ).toEqual({
        type: 'fail',
        reason: 'stalled',
      });
    });
  });

  describe('silent working agent', () => {
    it('nudges exactly at the silence boundary', () => {
      expect(watch(attempt(), observe('working', 0), 9_999, policy)).toEqual({
        type: 'none',
      });
      expect(watch(attempt(), observe('working', 0), 10_000, policy)).toEqual({
        type: 'remind',
        kind: 'silent',
      });
    });

    it('stalls when still silent after the nudge', () => {
      expect(
        watch(
          attempt({ reminders: { idle: 0, silent: 1 } }),
          observe('working', 0),
          10_000,
          policy,
        ),
      ).toEqual({ type: 'fail', reason: 'stalled' });
    });

    it('stays quiet while output keeps arriving', () => {
      expect(
        watch(attempt(), observe('working', 9_000), 10_000, policy),
      ).toEqual({ type: 'none' });
    });
  });

  describe('open questions', () => {
    it('does not count answered waiting time towards the timeout', () => {
      const answered = attempt({ pausedMs: 50_000 });
      expect(
        watch(answered, observe('working', 59_000), 60_000, policy),
      ).toEqual({ type: 'none' });
      expect(
        watch(answered, observe('working', 109_000), 110_000, policy),
      ).toEqual({ type: 'fail', reason: 'timed_out' });
    });

    it('does not count the time of a question that is still open', () => {
      const waiting = attempt({ pausedSince: 5_000 });
      expect(
        watch(waiting, observe('working', 100_000), 3_600_000, policy),
      ).toEqual({ type: 'none' });
    });

    it('sends no reminders to an agent that waits for an answer', () => {
      const waiting = attempt({ pausedSince: 5_000 });
      expect(watch(waiting, observe('idle', 0), 20_000, policy)).toEqual({
        type: 'none',
      });
    });

    it('still reports a crash while a question is open', () => {
      const waiting = attempt({ pausedSince: 5_000 });
      expect(watch(waiting, observe('gone'), 20_000, policy)).toEqual({
        type: 'fail',
        reason: 'crashed',
      });
    });
  });

  describe('policy for the operator', () => {
    it('uses the operator timeout of the workflow', () => {
      expect(
        watchPolicyFor(loadWorkflow('feature'), 'operator').timeoutMs,
      ).toBe(1_200_000);
    });
  });
});
