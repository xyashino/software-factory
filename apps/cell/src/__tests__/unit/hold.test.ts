import { describe, expect, it } from 'vitest';
import { closeHold, holdDue, openHold } from '../../cycle/hold';
import { watch } from '@repo/factory-core/cycle/watch';

const cycle = { startedAt: 0, pausedMs: 0, reminders: { idle: 0, silent: 0 } };

describe('question hold', () => {
  it('stamps the open and adds the held time to the paused total on close', () => {
    const held = openHold(cycle, 1_000);
    expect(held.pausedSince).toBe(1_000);
    const resumed = closeHold(held, 4_000);
    expect(resumed.pausedMs).toBe(3_000);
    expect(resumed.pausedSince).toBeUndefined();
  });

  it('does not change a cycle that is not held', () => {
    expect(closeHold(cycle, 9_000)).toBe(cycle);
    expect(openHold(openHold(cycle, 1_000), 5_000).pausedSince).toBe(1_000);
  });

  it('is due only once the hold has lasted the whole hold time', () => {
    const held = openHold(cycle, 1_000);
    expect(holdDue(held, 30_999, 30_000)).toBe(false);
    expect(holdDue(held, 31_000, 30_000)).toBe(true);
    expect(holdDue(cycle, 31_000, 30_000)).toBe(false);
  });

  it('keeps the watch from timing out while held, and times out once the held time is returned', () => {
    const policy = {
      timeoutMs: 60_000,
      idleReminders: 2,
      silentMs: 10_000,
      silentNudges: 1,
    };
    const held = openHold({ ...cycle, startedAt: 0 }, 10_000);
    expect(
      watch(held, { operator: 'working', lastOutputAt: 0 }, 500_000, policy),
    ).toEqual({ type: 'none' });
    const resumed = closeHold(held, 500_000);
    expect(
      watch(
        resumed,
        { operator: 'working', lastOutputAt: 549_000 },
        549_999,
        policy,
      ),
    ).toEqual({ type: 'none' });
    expect(
      watch(
        resumed,
        { operator: 'working', lastOutputAt: 549_000 },
        550_000,
        policy,
      ),
    ).toEqual({
      type: 'fail',
      reason: 'timed_out',
    });
  });
});
