import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { OrderEvent, StoredEvent } from '../events';
import { type ProjectionMeta, toProjection } from '../projection';
import type { WorkOrderState } from '../state';
import { boardStatus, holderOf } from '../status';
import {
  ORDER_ID,
  andonRaised,
  blobOf,
  cellIdOf,
  commitOf,
  created,
  cycleBlocked,
  cycleCompleted,
  cycleIdOf,
  cycleStarted,
  fold,
  history,
  jobClaimed,
  jobIdOf,
  stationOf,
  usageRecorded,
  verdictRecorded,
} from './builders';

const META: ProjectionMeta = {
  lastSeq: 1,
  createdAt: 0,
  updatedAt: 0,
  next: { kind: 'done' },
};

/** A Work order that ran three Cycles: two passes, then a blocked Cycle with an Andon. */
const scenario = (): OrderEvent[] => [
  created(),
  jobClaimed({
    jobId: jobIdOf(1),
    cycleId: cycleIdOf(1),
    cellId: cellIdOf(1),
    epoch: 1,
  }),
  cycleStarted({
    cycleId: cycleIdOf(1),
    jobId: jobIdOf(1),
    stationId: stationOf('plan'),
    n: 1,
    cause: { kind: 'first' },
    baseCommit: commitOf(1),
  }),
  cycleCompleted({ cycleId: cycleIdOf(1), commit: commitOf(2), artifacts: {} }),
  jobClaimed({
    jobId: jobIdOf(2),
    cycleId: cycleIdOf(2),
    cellId: cellIdOf(1),
    epoch: 2,
  }),
  cycleStarted({
    cycleId: cycleIdOf(2),
    jobId: jobIdOf(2),
    stationId: stationOf('build'),
    n: 1,
    cause: { kind: 'first' },
    baseCommit: commitOf(2),
  }),
  verdictRecorded({
    cycleId: cycleIdOf(2),
    pass: true,
    artifacts: {},
    commit: commitOf(3),
  }),
  jobClaimed({
    jobId: jobIdOf(3),
    cycleId: cycleIdOf(3),
    cellId: cellIdOf(1),
    epoch: 3,
  }),
  cycleStarted({
    cycleId: cycleIdOf(3),
    jobId: jobIdOf(3),
    stationId: stationOf('audit'),
    n: 1,
    cause: { kind: 'first' },
    baseCommit: commitOf(3),
  }),
  cycleBlocked({ cycleId: cycleIdOf(3), commit: commitOf(4) }),
  andonRaised({ reason: 'cycle_blocked' }),
];

/** A late fact as stored, with its own time, so inserting it leaves every other event's time alone. */
const lateFact = (event: OrderEvent, at: number): StoredEvent => ({
  schemaVersion: 2,
  seq: 1,
  globalSeq: 1,
  orderId: ORDER_ID,
  at,
  actor: { kind: 'factory' },
  commandId: `late-${at}`,
  event,
});

/** Inserts a stored fact before the event at `position` (1-based, never before `created`). */
const insertAt = (
  stored: StoredEvent[],
  position: number,
  fact: StoredEvent,
): StoredEvent[] => [
  ...stored.slice(0, position),
  fact,
  ...stored.slice(position),
];

/** The state with the usage figures removed: all a late usage fact may change. */
const withoutUsage = (state: WorkOrderState): WorkOrderState => ({
  ...state,
  cycles: state.cycles.map((cycle) => ({ ...cycle, usage: undefined })),
});

describe('I3 late facts are inert', () => {
  const stored = history(...scenario());
  const base = fold(stored);

  it('inserting usage about any Cycle anywhere changes only that usage', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: stored.length }),
        fc.constantFrom(1, 2, 3),
        (position, cycle) => {
          const fact = lateFact(
            usageRecorded({ cycleId: cycleIdOf(cycle) }),
            position * 1000 + 500,
          );
          expect(withoutUsage(fold(insertAt(stored, position, fact)))).toEqual(
            withoutUsage(base),
          );
        },
      ),
    );
  });

  it('inserting usage leaves the board status, the holder and the projection untouched', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: stored.length }), (position) => {
        const fact = lateFact(
          usageRecorded({ cycleId: cycleIdOf(2) }),
          position * 1000 + 500,
        );
        const state = fold(insertAt(stored, position, fact));
        expect(boardStatus(state)).toBe(boardStatus(base));
        expect(holderOf(state)).toEqual(holderOf(base));
        expect(toProjection(state, META)).toEqual(toProjection(base, META));
      }),
    );
  });

  it('a verdict about a Cycle that already ended is inert wherever it lands after that Cycle', () => {
    // Index 4 is the first position after cycle 1 completed (event index 3): the Cycle is no longer live.
    fc.assert(
      fc.property(fc.integer({ min: 4, max: stored.length }), (position) => {
        const late = verdictRecorded({
          cycleId: cycleIdOf(1),
          pass: false,
          artifacts: {},
          feedbackBlob: blobOf(9),
        });
        expect(
          fold(
            insertAt(stored, position, lateFact(late, position * 1000 + 500)),
          ),
        ).toEqual(base);
      }),
    );
  });
});
