/**
 * Property tests for CORE §10 (I1, I3-I9, I11) over generated command sequences against a generated
 * Line. Run count: FACTORY_PROPERTY_RUNS (default 500, CI-sized). `test:properties` runs 10 000.
 *
 *   FACTORY_PROPERTY_RUNS=10000 bun --bun vitest run invariants
 *
 * A failing property prints its seed and the shrunk sequence; add it to `examples` below as a
 * regression. I10 (idempotent commands) is a store contract test, out of scope here (v2-07).
 */
import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import type { StationId } from '../../ids';
import type { LineSnapshot, Station } from '../../line/snapshot';
import {
  cycleCompleted,
  questionAnswered,
  usageRecorded,
} from '../../testing/event-builders';
import type { OrderEvent, StoredEvent } from '../events';
import { isLive } from '../evolve-helpers';
import { nextJob } from '../next-job';
import type { WorkOrderState } from '../state';
import { arbIntents, arbLine } from './generators';
import { foldEach, runSequence } from './runner';

const RUNS = Number(process.env.FACTORY_PROPERTY_RUNS ?? 500);
const ORDER_CASES = { numRuns: RUNS };

// 10 000 runs of a property take minutes; the default five seconds would cut them off.
vi.setConfig({ testTimeout: 60 * 60 * 1000 });

/** The last state of a Traveler, or undefined when it has no events. */
const lastState = (
  events: readonly StoredEvent[],
): WorkOrderState | undefined => foldEach(events).at(-1);

/** Renumbers seq and globalSeq so a spliced Traveler is a valid one. */
const renumber = (events: readonly StoredEvent[]): StoredEvent[] =>
  events.map((stored, index) => ({
    ...stored,
    seq: index + 1,
    globalSeq: index + 1,
  }));

/**
 * The state without the fields a late fact may change (CORE §10 I3): a Cycle's usage, and a
 * question's answer together with the status that answering sets.
 */
const withoutLateFields = (state: WorkOrderState | undefined) =>
  state && {
    ...state,
    cycles: state.cycles.map((cycle) => ({ ...cycle, usage: undefined })),
    questions: state.questions.map((question) => ({
      ...question,
      answer: undefined,
      status: undefined,
    })),
  };

const stationOfId = (line: LineSnapshot, id: StationId): Station | undefined =>
  line.stations.find((station) => station.id === id);

const stationIndex = (line: LineSnapshot, id: StationId): number =>
  line.stations.findIndex((station) => station.id === id);

/** The index of a Work order's phase on the Line: delivery sits after every Station. */
const phaseIndexOf = (state: WorkOrderState): number =>
  state.phase.kind === 'stations'
    ? state.phase.index
    : state.line.stations.length;

describe('I1 determinism', () => {
  it('folds the same events to the same state and next job, through JSON too', () => {
    fc.assert(
      fc.property(arbLine, arbIntents(), (line, intents) => {
        const { events } = runSequence(line, intents);
        const first = lastState(events);
        const again = lastState(events);
        const replayed = lastState(
          JSON.parse(JSON.stringify(events)) as StoredEvent[],
        );

        expect(again).toEqual(first);
        expect(replayed).toEqual(first);
        if (first && replayed) {
          expect(nextJob(replayed)).toEqual(nextJob(first));
        }
      }),
      ORDER_CASES,
    );
  });
});

describe('I3 late facts are inert', () => {
  it('leaves nextJob unchanged when an event about an ended Cycle is inserted', () => {
    fc.assert(
      fc.property(
        arbLine,
        arbIntents(),
        fc.nat(),
        fc.constantFrom('usage', 'stale', 'answer'),
        (line, intents, pick, kind) => {
          const { events } = runSequence(line, intents);
          const states = foldEach(events);
          const final = states.at(-1);
          if (!final) return;
          const ended = final.cycles.filter(
            (cycle) => !isLive(final, cycle.cycleId),
          );
          if (ended.length === 0) return;

          const cycle = ended[pick % ended.length];
          if (!cycle) return;
          const startedAt = events.findIndex(
            (stored) =>
              stored.event.type === 'cycle_started' &&
              stored.event.cycleId === cycle.cycleId,
          );
          const endedAt = states.findIndex(
            (state, index) =>
              index > startedAt &&
              state !== undefined &&
              !isLive(state, cycle.cycleId),
          );
          if (endedAt < 0) return;

          const question = final.questions.find(
            (candidate) => candidate.cycleId === cycle.cycleId,
          );
          const late: OrderEvent =
            kind === 'answer' && question
              ? questionAnswered({ questionId: question.questionId })
              : kind === 'stale'
                ? cycleCompleted({ cycleId: cycle.cycleId })
                : usageRecorded({ cycleId: cycle.cycleId });
          const at = Math.min(
            events.length,
            endedAt + 1 + (pick % Math.max(1, events.length - endedAt)),
          );
          const envelope: StoredEvent = {
            schemaVersion: 2,
            seq: at + 1,
            globalSeq: at + 1,
            orderId: events[0]?.orderId ?? ('x:y' as StoredEvent['orderId']),
            at: events[Math.max(0, at - 1)]?.at ?? 0,
            actor: { kind: 'factory' },
            commandId: 'late-fact',
            event: late,
          };
          const spliced = renumber([
            ...events.slice(0, at),
            envelope,
            ...events.slice(at),
          ]);

          const before = lastState(events);
          const after = lastState(spliced);
          expect(after && nextJob(after)).toEqual(before && nextJob(before));
          expect(withoutLateFields(after)).toEqual(withoutLateFields(before));
        },
      ),
      ORDER_CASES,
    );
  });
});

describe('I4 single writer', () => {
  it('stamps every worker and operator event with the epoch of its active job', () => {
    fc.assert(
      fc.property(arbLine, arbIntents(), (line, intents) => {
        const { events } = runSequence(line, intents);
        const states = foldEach(events);
        // The job active when a command was appended: the state before its first event. A command
        // can end the job within its own events (a release emits cycle_failed then job_lost).
        let commandStart: StoredEvent | undefined;
        let activeBefore: number | undefined;

        events.forEach((stored, index) => {
          if (stored.commandId !== commandStart?.commandId) {
            commandStart = stored;
            activeBefore =
              index === 0 ? undefined : states[index - 1]?.activeJob?.epoch;
          }
          if (stored.event.type === 'usage_recorded') return;
          if (
            stored.actor.kind !== 'worker' &&
            stored.actor.kind !== 'operator'
          ) {
            return;
          }
          expect(stored.epoch, `event ${index} ${stored.event.type}`).toBe(
            activeBefore,
          );
        });
      }),
      ORDER_CASES,
    );
  });
});

describe('I5 monotone epochs', () => {
  it('increases job_claimed.epoch strictly for every Work order', () => {
    fc.assert(
      fc.property(arbLine, arbIntents(), (line, intents) => {
        const { events } = runSequence(line, intents);
        const epochs = events.flatMap((stored) =>
          stored.event.type === 'job_claimed' ? [stored.event.epoch] : [],
        );
        for (let index = 1; index < epochs.length; index += 1) {
          expect(epochs[index]).toBeGreaterThan(epochs[index - 1] ?? 0);
        }
      }),
      ORDER_CASES,
    );
  });
});

describe('I6 progress is kept', () => {
  it('never drops a passed Station or moves the phase back on progress-safe events', () => {
    fc.assert(
      fc.property(arbLine, arbIntents(), (line, intents) => {
        const { events } = runSequence(line, intents);
        const states = foldEach(events);

        events.forEach((stored, index) => {
          const before = states[index - 1];
          const after = states[index];
          if (!before || !after) return;
          const type = stored.event.type;
          const restartOrReopen =
            (type === 'resumed' && stored.event.mode.kind === 'restart_from') ||
            type === 'reopened';
          const safe =
            type === 'cycle_blocked' ||
            type === 'cycle_handed_over' ||
            type === 'andon_raised' ||
            type === 'job_lost' ||
            (type === 'resumed' && stored.event.mode.kind === 'retry_station');

          const dropped = Object.keys(before.lastPassed).filter(
            (key) => after.lastPassed[key as StationId] === undefined,
          ) as StationId[];

          if (safe) {
            expect(dropped, `event ${index} ${type}`).toEqual([]);
            expect(
              phaseIndexOf(after),
              `event ${index} ${type}`,
            ).toBeGreaterThanOrEqual(phaseIndexOf(before));
          }
          if (restartOrReopen) {
            const target =
              stored.event.type === 'reopened'
                ? stored.event.stationId
                : stored.event.type === 'resumed' &&
                    stored.event.mode.kind === 'restart_from'
                  ? stored.event.mode.stationId
                  : undefined;
            const at = target ? stationIndex(line, target) : -1;
            for (const id of dropped) {
              expect(
                stationIndex(line, id),
                `event ${index} drops ${id}`,
              ).toBeGreaterThanOrEqual(at);
            }
          }
        });
      }),
      ORDER_CASES,
    );
  });
});

describe('I7 Andons hold no Worker', () => {
  it('has no active job whenever an Andon is raised', () => {
    fc.assert(
      fc.property(arbLine, arbIntents(), (line, intents) => {
        const { events } = runSequence(line, intents);
        for (const state of foldEach(events)) {
          if (state.andon) {
            expect(state.activeJob).toBeUndefined();
          }
        }
      }),
      ORDER_CASES,
    );
  });
});

describe('I8 bounded retries', () => {
  // v1: "bounds build attempts for any sequence of outcomes" (the v2 form is this property; the
  // budgets it checks are the ones the workflow scenarios exercise by name)
  it('keeps retriesUsed within onFail.max plus the granted retries, for every Station', () => {
    fc.assert(
      fc.property(arbLine, arbIntents(), (line, intents) => {
        const { events } = runSequence(line, intents);
        for (const state of foldEach(events)) {
          for (const station of state.line.stations) {
            const used = state.retriesUsed[station.id] ?? 0;
            const granted = state.retryGrants[station.id] ?? 0;
            expect(used, `${station.id}`).toBeLessThanOrEqual(
              (station.onFail?.max ?? 0) + granted,
            );
          }
        }
      }),
      ORDER_CASES,
    );
  });
});

describe('I9 no silent stop', () => {
  it('never reports done before the Work order is delivered or cancelled, and never stops silently', () => {
    fc.assert(
      fc.property(arbLine, arbIntents(), (line, intents) => {
        const { events } = runSequence(line, intents);
        const states = foldEach(events);

        events.forEach((stored, index) => {
          const state = states[index];
          if (!state) return;
          const terminal =
            state.phase.kind === 'delivered' ||
            state.phase.kind === 'cancelled';
          if (!terminal) {
            expect(
              nextJob(state).kind,
              `event ${index} ${stored.event.type}`,
            ).not.toBe('done');
          }
          if (stored.event.type === 'andon_raised') {
            expect(nextJob(state).kind, `event ${index}`).toBe(
              'await_supervisor',
            );
          }
          if (
            stored.event.type === 'resumed' ||
            stored.event.type === 'reopened'
          ) {
            expect(
              nextJob(state).kind,
              `event ${index} ${stored.event.type}`,
            ).toBe('job');
          }
        });
      }),
      ORDER_CASES,
    );
  });
});

describe('I11 bounded machine loss', () => {
  it('bounds consecutive lost, handed-over or workspace-failed Cycles of a Station', () => {
    fc.assert(
      fc.property(
        arbLine,
        arbIntents({ withSupervisor: false }),
        (line, intents) => {
          const { events } = runSequence(line, intents);
          const states = foldEach(events);
          const streak = new Map<StationId, number>();
          let claimedStation: StationId | undefined;

          events.forEach((stored, index) => {
            const before = states[index - 1];
            const after = states[index];
            if (!after) return;
            const event = stored.event;
            const stationOfCycle = (cycleId: string): StationId | undefined =>
              after.cycles.find((cycle) => cycle.cycleId === cycleId)
                ?.stationId;

            if (event.type === 'job_claimed') {
              const pending = before
                ? nextJob({ ...before, activeJob: undefined })
                : undefined;
              claimedStation =
                pending?.kind === 'job' && pending.job.kind !== 'deliver'
                  ? pending.job.stationId
                  : undefined;
            }
            if (event.type === 'workspace_failed' && claimedStation) {
              streak.set(claimedStation, (streak.get(claimedStation) ?? 0) + 1);
            }
            if (event.type === 'cycle_failed' && event.reason === 'lost') {
              const id = stationOfCycle(event.cycleId);
              if (id) streak.set(id, (streak.get(id) ?? 0) + 1);
            }
            if (event.type === 'cycle_handed_over') {
              const id = stationOfCycle(event.cycleId);
              if (id) streak.set(id, (streak.get(id) ?? 0) + 1);
            }
            if (event.type === 'cycle_completed') {
              const id = stationOfCycle(event.cycleId);
              if (id) streak.set(id, 0);
            }
            if (event.type === 'verdict_recorded' && event.pass) {
              const id = stationOfCycle(event.cycleId);
              if (id) streak.set(id, 0);
            }
            if (event.type === 'inspection_finished' && event.passed) {
              const id = stationOfCycle(event.cycleId);
              if (id) streak.set(id, 0);
            }
            if (event.type === 'andon_raised') {
              streak.clear();
            }

            for (const [id, count] of streak) {
              const station: Station | undefined = stationOfId(after.line, id);
              const limit = station
                ? station.maxRestarts + station.maxLostRestarts + 2
                : 0;
              expect(
                count,
                `event ${index} ${event.type} ${id}`,
              ).toBeLessThanOrEqual(limit);
            }
          });
        },
      ),
      ORDER_CASES,
    );
  });
});

describe('coverage: the properties are not vacuous', () => {
  it('reaches Andons and deliveries in a useful share of sequences', () => {
    const samples = fc.sample(fc.tuple(arbLine, arbIntents()), {
      numRuns: 300,
      seed: 20260612,
    });
    let withAndon = 0;
    let delivered = 0;
    let withQuestion = 0;
    for (const [line, intents] of samples) {
      const { events } = runSequence(line, intents);
      const states = foldEach(events);
      if (states.some((state) => state?.andon)) withAndon += 1;
      if (states.at(-1)?.phase.kind === 'delivered') delivered += 1;
      if (states.some((state) => state?.questions.length)) withQuestion += 1;
    }

    // Floors, not targets: a property that never meets an Andon or a delivery would pass vacuously.
    expect(withAndon / samples.length).toBeGreaterThan(0.1);
    expect(delivered / samples.length).toBeGreaterThan(0.1);
    expect(withQuestion / samples.length).toBeGreaterThan(0.05);
  });
});
