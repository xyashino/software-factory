import type { CommitSha, CycleId, StationId } from '../ids';
import type { OrderEvent } from './events';
import {
  andonStation,
  bump,
  latestCycle,
  requireCycle,
  requireIndex,
  resetCounter,
} from './evolve-helpers';
import type { CycleState, WorkOrderState } from './state';

type ResumedEvent = Extract<OrderEvent, { type: 'resumed' }>;
type ReopenedEvent = Extract<OrderEvent, { type: 'reopened' }>;

/** The Stations that passed before `index`; everything at or after it is forgotten (rules 8-9). */
const passedBefore = (
  state: WorkOrderState,
  index: number,
): WorkOrderState['lastPassed'] => {
  const kept: WorkOrderState['lastPassed'] = {};
  state.line.stations.slice(0, index).forEach((station) => {
    const cycleId = state.lastPassed[station.id];
    if (cycleId) kept[station.id] = cycleId;
  });
  return kept;
};

/** CORE §4.3 rule 8: the newest commit a Station strictly before `index` checkpointed. */
const checkpointBefore = (
  state: WorkOrderState,
  index: number,
): WorkOrderState['checkpoint'] => {
  for (let position = index - 1; position >= 0; position -= 1) {
    const station = state.line.stations[position];
    const cycleId = station ? state.lastPassed[station.id] : undefined;
    const commit = cycleId ? requireCycle(state, cycleId).commit : undefined;
    if (station && commit) return { commit, afterStation: station.id };
  }
  return undefined;
};

const pendingFor = (
  state: WorkOrderState,
  resume: Pick<ResumedEvent, 'resumeId' | 'noteBlob'>,
  forStation: StationId,
  fromCycle?: CycleId,
): WorkOrderState => ({
  ...state,
  pendingResume: {
    resumeId: resume.resumeId,
    forStation,
    fromCycle,
    noteBlob: resume.noteBlob,
  },
});

/** CORE §4.3 rule 7: the Supervisor resumes at the Andon's Station. */
const retryStation = (
  state: WorkOrderState,
  ev: ResumedEvent,
): WorkOrderState => {
  const reason = state.andon?.reason;
  const station = andonStation(state);
  const cleared: WorkOrderState = {
    ...state,
    andon: undefined,
    workspaceFailures: [],
    resumedWaiting: true,
  };
  const granted =
    station && ev.grantRetries
      ? {
          ...cleared,
          retryGrants: bump(cleared.retryGrants, station, ev.grantRetries),
        }
      : cleared;
  const latest: CycleState | undefined = latestCycle(state);
  switch (reason) {
    case 'cycle_blocked':
    case 'no_retry':
      return latest
        ? pendingFor(granted, ev, latest.stationId, latest.cycleId)
        : granted;
    case 'restart_failed':
      if (!latest) return granted;
      return {
        ...pendingFor(granted, ev, latest.stationId, latest.cycleId),
        restartsUsed: resetCounter(granted.restartsUsed, latest.stationId),
        lostRestartsUsed: resetCounter(
          granted.lostRestartsUsed,
          latest.stationId,
        ),
      };
    case 'delivery_failed':
      return { ...granted, deliveryFailed: undefined };
    case 'retries_exhausted':
    case 'workspace_failed':
    case undefined:
      return granted;
  }
};

/** CORE §4.3 rule 8: the Supervisor moves the Work order back to an earlier Station. */
const restartFrom = (
  state: WorkOrderState,
  ev: ResumedEvent,
  stationId: StationId,
): WorkOrderState => {
  const index = requireIndex(state, stationId);
  const restarted: WorkOrderState = {
    ...state,
    andon: undefined,
    workspaceFailures: [],
    deliveryFailed: undefined,
    pendingFeedback: undefined,
    phase: { kind: 'stations', index },
    lastPassed: passedBefore(state, index),
    checkpoint: checkpointBefore(state, index),
    resumedWaiting: true,
  };
  return pendingFor(restarted, ev, stationId);
};

/** The Andon is cleared and the Work order may run again (CORE §4.3 rules 7-8). */
export const applyResumed = (
  state: WorkOrderState,
  ev: ResumedEvent,
): WorkOrderState =>
  ev.mode.kind === 'restart_from'
    ? restartFrom(state, ev, ev.mode.stationId)
    : retryStation(state, ev);

/** CORE §4.3 rule 9: a delivered Work order is reopened at a Station, on top of the delivered commit. */
export const applyReopened = (
  state: WorkOrderState,
  ev: ReopenedEvent,
): WorkOrderState => {
  if (state.phase.kind !== 'delivered' || !state.delivery) return state;
  const index = requireIndex(state, ev.stationId);
  const commit: CommitSha = state.delivery.commit;
  const reopened: WorkOrderState = {
    ...state,
    phase: { kind: 'stations', index },
    lastPassed: passedBefore(state, index),
    checkpoint: {
      commit,
      afterStation: state.line.stations[index - 1]?.id ?? null,
    },
    workspaceFailures: [],
    resumedWaiting: true,
  };
  return pendingFor(reopened, ev, ev.stationId);
};

export const applyAndonRaised = (
  state: WorkOrderState,
  ev: Extract<OrderEvent, { type: 'andon_raised' }>,
  at: number,
): WorkOrderState => ({
  ...state,
  andon: { reason: ev.reason, detail: ev.detail, at },
});
