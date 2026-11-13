import { describe, expect, it } from 'vitest';
import { boardStatus, holderOf } from '../status';
import type { OrderEvent } from '../events';
import type { WorkOrderState } from '../state';
import {
  andonRaised,
  cancelled,
  cellIdOf,
  commitOf,
  created,
  cycleBlocked,
  cycleCompleted,
  cycleIdOf,
  cycleStarted,
  deliveryFinished,
  fold,
  history,
  inspectionFinished,
  jobClaimed,
  jobIdOf,
  prStateChanged,
  questionAsked,
  questionIdOf,
  stationOf,
  verdictRecorded,
} from './builders';

const foldEvents = (...events: OrderEvent[]): WorkOrderState =>
  fold(history(...events));

const claim = (n: number) =>
  jobClaimed({
    jobId: jobIdOf(n),
    cycleId: cycleIdOf(n),
    cellId: cellIdOf(1),
    epoch: n,
  });
const claimDelivery = (n: number) =>
  jobClaimed({
    jobId: jobIdOf(n),
    kind: 'deliver',
    cellId: cellIdOf(1),
    epoch: n,
    cycleId: undefined,
  });
const start = (n: number, station: string) =>
  cycleStarted({
    cycleId: cycleIdOf(n),
    jobId: jobIdOf(n),
    stationId: stationOf(station),
    n: 1,
    cause: { kind: 'first' },
    baseCommit: commitOf(n),
  });

/** A Work order whose four Stations all passed and whose delivery job is claimed. */
const readyToDeliver = (): OrderEvent[] => [
  created(),
  claim(1),
  start(1, 'plan'),
  cycleCompleted({ cycleId: cycleIdOf(1), commit: commitOf(1), artifacts: {} }),
  claim(2),
  start(2, 'build'),
  cycleCompleted({ cycleId: cycleIdOf(2), commit: commitOf(2), artifacts: {} }),
  claim(3),
  start(3, 'audit'),
  verdictRecorded({
    cycleId: cycleIdOf(3),
    pass: true,
    artifacts: {},
    commit: commitOf(3),
  }),
  claim(4),
  start(4, 'check'),
  inspectionFinished({ cycleId: cycleIdOf(4), passed: true, results: [] }),
];

describe('holderOf', () => {
  it('holds the Work order in the queue when nothing runs', () => {
    expect(holderOf(foldEvents(created()))).toEqual({ kind: 'queue' });
  });

  it('holds the Work order with the Cell of the active job and its epoch', () => {
    expect(holderOf(foldEvents(created(), claim(1)))).toEqual({
      kind: 'cell',
      cellId: cellIdOf(1),
      epoch: 1,
    });
  });

  it('keeps the Cell while a question is open, because the Operator waits in its pane', () => {
    const state = foldEvents(
      created(),
      claim(1),
      start(1, 'plan'),
      questionAsked({ cycleId: cycleIdOf(1), questionId: questionIdOf(1) }),
    );
    expect(holderOf(state).kind).toBe('cell');
  });

  it('holds the Work order with the supervisor when an Andon is raised and no job runs', () => {
    expect(
      holderOf(foldEvents(created(), andonRaised({ reason: 'no_retry' }))),
    ).toEqual({
      kind: 'supervisor',
      cause: 'andon',
    });
  });

  it('holds nothing once the Work order is delivered', () => {
    const state = foldEvents(
      ...readyToDeliver(),
      claimDelivery(5),
      deliveryFinished({ jobId: jobIdOf(5), commit: commitOf(5) }),
    );
    expect(holderOf(state)).toEqual({ kind: 'none' });
  });

  it('holds nothing once the Work order is cancelled', () => {
    expect(holderOf(foldEvents(created(), cancelled()))).toEqual({
      kind: 'none',
    });
  });
});

describe('boardStatus', () => {
  it('is queued when nothing runs', () => {
    expect(boardStatus(foldEvents(created()))).toBe('queued');
  });

  it('is running while a Station job is active', () => {
    expect(boardStatus(foldEvents(created(), claim(1), start(1, 'plan')))).toBe(
      'running',
    );
  });

  it('is waiting_answer while the active Cycle has an open question', () => {
    const state = foldEvents(
      created(),
      claim(1),
      start(1, 'plan'),
      questionAsked({ cycleId: cycleIdOf(1), questionId: questionIdOf(1) }),
    );
    expect(boardStatus(state)).toBe('waiting_answer');
  });

  it('is andon when an Andon is raised and no job runs', () => {
    expect(
      boardStatus(foldEvents(created(), andonRaised({ reason: 'no_retry' }))),
    ).toBe('andon');
  });

  it('is delivering when every Station passed and the delivery is still queued', () => {
    expect(boardStatus(foldEvents(...readyToDeliver()))).toBe('delivering');
  });

  it('is delivering while the delivery job runs', () => {
    expect(boardStatus(foldEvents(...readyToDeliver(), claimDelivery(5)))).toBe(
      'delivering',
    );
  });

  it('is delivered once the PR is open', () => {
    const state = foldEvents(
      ...readyToDeliver(),
      claimDelivery(5),
      deliveryFinished({ jobId: jobIdOf(5), commit: commitOf(5) }),
    );
    expect(boardStatus(state)).toBe('delivered');
  });

  it('is merged once the PR is merged', () => {
    const state = foldEvents(
      ...readyToDeliver(),
      claimDelivery(5),
      deliveryFinished({ jobId: jobIdOf(5), commit: commitOf(5) }),
      prStateChanged({ state: 'merged' }),
    );
    expect(boardStatus(state)).toBe('merged');
  });

  it('is cancelled once the Work order is cancelled', () => {
    expect(boardStatus(foldEvents(created(), cancelled()))).toBe('cancelled');
  });

  it('keeps the status of a blocked Cycle as andon once the Andon is raised', () => {
    const state = foldEvents(
      created(),
      claim(1),
      start(1, 'plan'),
      cycleBlocked({ cycleId: cycleIdOf(1) }),
      andonRaised({ reason: 'cycle_blocked' }),
    );
    expect(boardStatus(state)).toBe('andon');
  });
});
