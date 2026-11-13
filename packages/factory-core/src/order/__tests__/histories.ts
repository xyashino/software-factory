import type { BlobRef, CommitSha } from '../../ids';
import type { CommandOf } from '../commands';
import type { CycleCause, JobKind, OrderEvent } from '../events';
import type { WorkOrderState } from '../state';
import {
  blobOf,
  commitOf,
  created,
  cycleCompleted,
  cycleIdOf,
  cycleStarted,
  fold,
  history,
  inspectionFinished,
  jobClaimed,
  jobIdOf,
  stationOf,
  verdictRecorded,
} from './builders';

/** The command that creates the default Work order (the fields of `order_created`). */
export const createCommand = (): CommandOf<'CreateOrder'> => ({
  ...created(),
  type: 'CreateOrder',
});

/** A job of kind `kind` is claimed; job and Cycle take number `n`. A delivery has no Cycle. */
export const claim = (
  n: number,
  kind: JobKind = 'run_operator_station',
): OrderEvent =>
  jobClaimed({
    jobId: jobIdOf(n),
    kind,
    epoch: n,
    cycleId: kind === 'deliver' ? undefined : cycleIdOf(n),
  });

/** The Cycle of job `n` starts on `station`. */
export const start = (
  n: number,
  station: string,
  options: { cause?: CycleCause; baseCommit?: CommitSha; count?: number } = {},
): OrderEvent =>
  cycleStarted({
    cycleId: cycleIdOf(n),
    jobId: jobIdOf(n),
    stationId: stationOf(station),
    n: options.count ?? 1,
    cause: options.cause ?? { kind: 'first' },
    baseCommit: options.baseCommit ?? commitOf(1),
  });

/** Claims and starts job `n` on `station`: the Cycle is running. */
export const begun = (n: number, station: string): OrderEvent[] => [
  claim(n),
  start(n, station),
];

/** An operator Station passes on its first Cycle, with `artifacts` and checkpoint `commit`. */
export const passedStation = (
  n: number,
  station: string,
  commit: number,
  artifacts: Record<string, BlobRef> = {},
): OrderEvent[] => [
  claim(n),
  start(n, station),
  cycleCompleted({
    cycleId: cycleIdOf(n),
    artifacts,
    commit: commitOf(commit),
  }),
];

/** The audit (verdict) Station passes its verdict on job `n`. */
export const passedVerdict = (n: number, commit: number): OrderEvent[] => [
  claim(n),
  start(n, 'audit'),
  verdictRecorded({
    cycleId: cycleIdOf(n),
    pass: true,
    artifacts: { review: blobOf(3) },
    commit: commitOf(commit),
  }),
];

/** The check Inspection passes on job `n`. */
export const passedInspection = (n: number): OrderEvent[] => [
  claim(n, 'run_inspection'),
  start(n, 'check'),
  inspectionFinished({ cycleId: cycleIdOf(n), passed: true, results: [] }),
];

/** Every Station of the default Line has passed: the Work order is delivering. */
export const deliveringEvents = (): OrderEvent[] => [
  created(),
  ...passedStation(1, 'plan', 2, { plan: blobOf(2) }),
  ...passedStation(2, 'build', 4),
  ...passedVerdict(3, 5),
  ...passedInspection(4),
];

/** The delivery job of a delivering Work order is claimed as job 5 and its PR is open. */
export const deliveredEvents = (): OrderEvent[] => [
  ...deliveringEvents(),
  claim(5, 'deliver'),
  {
    type: 'delivery_finished',
    jobId: jobIdOf(5),
    prUrl: 'https://github.com/example/software-factory/pull/42',
    commit: commitOf(6),
  },
];

/** Folds a list of events into the state they define. */
export const stateOf = (events: OrderEvent[]): WorkOrderState =>
  fold(history(...events));
