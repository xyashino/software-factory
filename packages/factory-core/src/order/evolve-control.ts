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
  baseCommit?: CommitSha,
): WorkOrderState => ({
  ...state,
  pendingResume: {
    resumeId: resume.resumeId,
    forStation,
    fromCycle,
    ...(baseCommit !== undefined ? { baseCommit } : {}),
    noteBlob: resume.noteBlob,
  },
});

const repairCommitOf = (state: WorkOrderState): CommitSha | undefined => {
  const andonAt = state.andon?.at;
  if (andonAt === undefined) return undefined;
  return state.incidents.find((incident) => incident.andonAt === andonAt)
    ?.commit;
};

/** CORE §4.3 rule 7: the Supervisor resumes at the Andon's Station. */
const retryStation = (
  state: WorkOrderState,
  ev: ResumedEvent,
): WorkOrderState => {
  const reason = state.andon?.reason;
  const repairCommit = repairCommitOf(state);
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
        ? pendingFor(
            granted,
            ev,
            latest.stationId,
            latest.cycleId,
            repairCommit,
          )
        : granted;
    case 'restart_failed':
      if (!latest) return granted;
      return {
        ...pendingFor(
          granted,
          ev,
          latest.stationId,
          latest.cycleId,
          repairCommit,
        ),
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
  const repairCommit = repairCommitOf(state);
  const restarted: WorkOrderState = {
    ...state,
    andon: undefined,
    workspaceFailures: [],
    deliveryFailed: undefined,
    pendingFeedback: undefined,
    phase: { kind: 'stations', index },
    lastPassed: passedBefore(state, index),
    checkpoint:
      repairCommit !== undefined
        ? {
            commit: repairCommit,
            afterStation: state.checkpoint?.afterStation ?? null,
          }
        : checkpointBefore(state, index),
    resumedWaiting: true,
  };
  return pendingFor(restarted, ev, stationId, undefined, repairCommit);
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
  andon: { reason: ev.reason, detail: ev.detail, at, triage: 'mechanic' },
});

/**
 * CORE §14.2: the incident joins the history and clears no Andon by itself. It ends the Mechanic job
 * that recorded it (CORE §14.4), and an `escalate` hands the Andon to the Supervisor (§14.4).
 * When the Mechanic repaired the worktree (`commit`), that commit becomes the latest checkpoint.
 */
export const applyIncidentRecorded = (
  state: WorkOrderState,
  ev: Extract<OrderEvent, { type: 'incident_recorded' }>,
  at: number,
): WorkOrderState => ({
  ...state,
  activeJob: state.activeJob?.kind === 'mechanic' ? undefined : state.activeJob,
  checkpoint:
    ev.commit !== undefined
      ? {
          commit: ev.commit,
          afterStation: state.checkpoint?.afterStation ?? null,
        }
      : state.checkpoint,
  andon:
    state.andon && ev.action.kind === 'escalate'
      ? { ...state.andon, triage: 'supervisor' }
      : state.andon,
  incidents: [
    ...state.incidents,
    {
      incidentId: ev.incidentId,
      by: ev.by,
      andonAt: ev.andonAt,
      andonReason: ev.andonReason,
      diagnosis: ev.diagnosis,
      action: ev.action,
      changes: ev.changes,
      outcome: ev.outcome,
      ...(ev.commit !== undefined ? { commit: ev.commit } : {}),
      at,
    },
  ],
});
