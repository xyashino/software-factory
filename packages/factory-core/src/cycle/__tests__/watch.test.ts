import { describe, expect, it } from 'vitest';
import {
  watch,
  type Observation,
  type RuntimeCycle,
  type WatchPolicy,
} from '../watch';

const policy: WatchPolicy = {
  timeoutMs: 60_000,
  idleReminders: 2,
  silentMs: 10_000,
  silentNudges: 1,
};

const cycle = (overrides: Partial<RuntimeCycle> = {}): RuntimeCycle => ({
  startedAt: 0,
  pausedMs: 0,
  reminders: { idle: 0, silent: 0 },
  ...overrides,
});

const seen = (
  operator: Observation['operator'],
  lastOutputAt = 0,
): Observation => ({
  operator,
  lastOutputAt,
});

describe('watch', () => {
  it('times out a Cycle that has run past its timeout', () => {
    expect(watch(cycle(), seen('working', 59_000), 60_000, policy)).toEqual({
      type: 'fail',
      reason: 'timed_out',
    });
  });

  it('crashes a Cycle whose pane is gone', () => {
    expect(watch(cycle(), seen('gone'), 1_000, policy)).toEqual({
      type: 'fail',
      reason: 'crashed',
    });
  });

  it('does nothing while a question holds the Cycle', () => {
    const held = cycle({ pausedSince: 1_000 });
    expect(watch(held, seen('blocked'), 2_000, policy)).toEqual({
      type: 'none',
    });
    expect(watch(held, seen('idle'), 2_000, policy)).toEqual({ type: 'none' });
  });

  it('blocks on a runner prompt', () => {
    expect(watch(cycle(), seen('blocked'), 1_000, policy)).toEqual({
      type: 'block',
      reason: 'runner_prompt',
    });
  });

  it('reminds an idle Operator until the idle reminders run out, then stalls', () => {
    expect(watch(cycle(), seen('idle'), 1_000, policy)).toEqual({
      type: 'remind',
      kind: 'idle',
    });
    expect(
      watch(
        cycle({ reminders: { idle: 1, silent: 0 } }),
        seen('idle'),
        1_000,
        policy,
      ),
    ).toEqual({ type: 'remind', kind: 'idle' });
    expect(
      watch(
        cycle({ reminders: { idle: 2, silent: 0 } }),
        seen('idle'),
        1_000,
        policy,
      ),
    ).toEqual({ type: 'fail', reason: 'stalled' });
  });

  it('reminds a silent working Operator once its silence reaches the threshold', () => {
    expect(watch(cycle(), seen('working', 0), 9_999, policy)).toEqual({
      type: 'none',
    });
    expect(watch(cycle(), seen('working', 0), 10_000, policy)).toEqual({
      type: 'remind',
      kind: 'silent',
    });
    expect(
      watch(
        cycle({ reminders: { idle: 0, silent: 1 } }),
        seen('working', 0),
        10_000,
        policy,
      ),
    ).toEqual({ type: 'fail', reason: 'stalled' });
  });

  it('leaves a working Operator alone when it printed recently', () => {
    expect(watch(cycle(), seen('working', 5_000), 6_000, policy)).toEqual({
      type: 'none',
    });
  });

  it('leaves an unknown observation alone', () => {
    expect(watch(cycle(), seen('unknown'), 1_000, policy)).toEqual({
      type: 'none',
    });
  });

  it('checks the timeout before the gone pane', () => {
    expect(watch(cycle(), seen('gone'), 60_000, policy)).toEqual({
      type: 'fail',
      reason: 'timed_out',
    });
  });

  it('checks a gone pane before a held question', () => {
    expect(
      watch(cycle({ pausedSince: 1_000 }), seen('gone'), 2_000, policy),
    ).toEqual({ type: 'fail', reason: 'crashed' });
  });

  it('checks a held question before a blocked prompt', () => {
    expect(
      watch(cycle({ pausedSince: 1_000 }), seen('blocked'), 2_000, policy),
    ).toEqual({ type: 'none' });
  });

  it('does not count paused time towards the timeout', () => {
    const paused = cycle({ pausedMs: 30_000 });
    expect(watch(paused, seen('working', 89_000), 89_999, policy)).toEqual({
      type: 'none',
    });
    expect(watch(paused, seen('working', 89_000), 90_000, policy)).toEqual({
      type: 'fail',
      reason: 'timed_out',
    });
  });

  it('counts an open hold as paused, so the timeout waits for the answer', () => {
    const held = cycle({ pausedSince: 10_000 });
    expect(watch(held, seen('working', 0), 70_000, policy)).toEqual({
      type: 'none',
    });
  });

  it('adds a closed hold to the paused time before the open one', () => {
    const resumed = cycle({ pausedMs: 20_000, pausedSince: undefined });
    expect(watch(resumed, seen('working', 79_000), 79_999, policy)).toEqual({
      type: 'none',
    });
    expect(watch(resumed, seen('working', 79_000), 80_000, policy)).toEqual({
      type: 'fail',
      reason: 'timed_out',
    });
  });
});
