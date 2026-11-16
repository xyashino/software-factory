import { describe, expect, it } from 'vitest';
import { decide } from '../decide';
import { MAX_WORKTREE_RESETS, nextJob } from '../next-job';
import { cellIdOf, contextOf, created, jobIdOf } from './builders';
import { claim, passedStation, stateOf } from './histories';
import type { OrderEvent } from '../events';

const cell = contextOf({ kind: 'cell', cellId: cellIdOf(1) }, { epoch: 1 });

const reportMissing = {
  type: 'ReportWorktreeMissing' as const,
  detail: 'the worktree is not on this cell',
};

/** An order past its first Station, with the next job claimed by the Cell. */
const pastStationZero = (): OrderEvent[] => [
  created(),
  ...passedStation(1, 'plan', 2),
  claim(2),
];

/** Two resets in a row: each reset goes back to Station 0, which passes again before the next job misses. */
const resetTwice = (): OrderEvent[] => [
  ...pastStationZero(),
  missingEvent(2),
  ...passedStation(3, 'plan', 4),
  claim(5),
  missingEvent(5),
];

const missingEvent = (n: number): OrderEvent => ({
  type: 'worktree_missing',
  jobId: jobIdOf(n),
  detail: 'the worktree is not on this cell',
});

describe('ReportWorktreeMissing', () => {
  it('records the missing worktree of a job past Station 0', () => {
    const state = stateOf(pastStationZero());
    const epochTwo = contextOf(
      { kind: 'cell', cellId: cellIdOf(1) },
      { epoch: 2 },
    );

    const result = decide(state, reportMissing, epochTwo);

    expect(result).toEqual({
      ok: true,
      value: [
        {
          type: 'worktree_missing',
          jobId: jobIdOf(2),
          detail: 'the worktree is not on this cell',
        },
      ],
    });
  });

  it('refuses a missing worktree on Station 0, which creates its own', () => {
    const state = stateOf([created(), claim(1)]);

    const result = decide(state, reportMissing, cell);

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'precondition',
        detail: 'a missing worktree resets only a Work order past Station 0',
      },
    });
  });
});

describe('worktree_missing (evolve)', () => {
  it('restarts the Work order at Station 0 and clears the attempt', () => {
    const state = stateOf([...pastStationZero(), missingEvent(2)]);

    expect(state.phase).toEqual({ kind: 'stations', index: 0 });
    expect(state.checkpoint).toBeUndefined();
    expect(state.lastPassed).toEqual({});
    expect(state.activeJob).toBeUndefined();
    expect(state.worktreeResets).toBe(1);
  });

  it('counts each reset, so the loop guard can bound them', () => {
    const state = stateOf(resetTwice());

    expect(state.worktreeResets).toBe(2);
  });
});

describe('nextJob loop guard (CORE §4.3 rule 13)', () => {
  it('re-runs Station 0 after one reset', () => {
    const state = stateOf([...pastStationZero(), missingEvent(2)]);

    expect(nextJob(state)).toMatchObject({
      kind: 'job',
      job: { kind: 'run_operator_station', stationId: 'plan' },
    });
  });

  it(`raises an Andon once ${MAX_WORKTREE_RESETS} resets happened without a delivery`, () => {
    const state = stateOf(resetTwice());

    expect(nextJob(state)).toEqual({
      kind: 'raise_andon',
      reason: 'workspace_failed',
      detail: `worktree missing on ${MAX_WORKTREE_RESETS} job(s) past Station 0 without a delivery`,
    });
  });
});
