import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WATCH_TIMING,
  HANDOVER_GRACE_MS,
  QUESTION_HOLD_MS,
  watchPolicyFor,
} from '../policy';

describe('cycle policy', () => {
  it('holds a question for 30 minutes and gives the Operator 5 minutes to hand over', () => {
    expect(QUESTION_HOLD_MS).toBe(1_800_000);
    expect(HANDOVER_GRACE_MS).toBe(300_000);
  });

  it('uses the v1 reminder timing by default', () => {
    expect(DEFAULT_WATCH_TIMING).toEqual({
      idleReminders: 2,
      silentMs: 300_000,
      silentNudges: 1,
    });
  });

  it('takes the timeout from the Operator and the reminder timing from the defaults', () => {
    expect(watchPolicyFor(900_000)).toEqual({
      timeoutMs: 900_000,
      ...DEFAULT_WATCH_TIMING,
    });
  });

  it('refuses a timeout that is not a positive whole number of milliseconds', () => {
    expect(() => watchPolicyFor(0)).toThrow(/positive integer/);
    expect(() => watchPolicyFor(1.5)).toThrow(/positive integer/);
  });
});
