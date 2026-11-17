import type { CommitSha, StationId } from '../ids';
import { findStation, stationAt, type Station } from '../line/snapshot';
import type { AndonReason, CycleCause } from './events';
import { latestCycle, requireCycle } from './evolve-helpers';
import { MECHANIC_BUDGET, type JobSpec, type Next } from './next';
import type { CycleOutcome, CycleState, WorkOrderState } from './state';

// Outcomes of an infrastructure failure: restarted, never judged.
const INFRA_OUTCOMES: readonly CycleOutcome[] = [
  'timed_out',
  'crashed',
  'stalled',
  'start_failed',
  'lost',
];

const requireStation = (state: WorkOrderState, id: StationId): Station => {
  const station = findStation(state.line, id);
  if (!station) {
    throw new Error(`station ${id} is not in line ${state.line.name}`);
  }
  return station;
};

/**
 * Missing-worktree resets to Station 0 allowed before the Work order raises an Andon instead of looping.
 * The counter resets on a delivery or a Supervisor resume.
 */
export const MAX_WORKTREE_RESETS = 2;

const WORKSPACE_DETAIL_CHARS = 512;

// The workspace Andon (row 4): names the count, then the latest failure's stage and detail, so the
// Mechanic sees the real cause without reading the log.
const workspaceAndon = (state: WorkOrderState): Next => {
  const failures = state.workspaceFailures;
  const count = failures.length;
  const latest = failures[count - 1];
  const summary = `${count} consecutive workspace failures`;
  if (latest === undefined) return andon('workspace_failed', summary);
  const text = `${summary}; last stage ${latest.stage}: ${latest.detail}`;
  return andon(
    'workspace_failed',
    Array.from(text).slice(0, WORKSPACE_DETAIL_CHARS).join(''),
  );
};

const usedOf = (counters: Record<StationId, number>, id: StationId): number =>
  counters[id] ?? 0;

const cyclesOf = (state: WorkOrderState, id: StationId): number =>
  state.cycles.filter((cycle) => cycle.stationId === id).length;

const checkpointBase = (state: WorkOrderState): CommitSha | 'branch_base' =>
  state.checkpoint?.commit ?? 'branch_base';

const andon = (reason: AndonReason, detail: string): Next => ({
  kind: 'raise_andon',
  reason,
  detail,
});

const stationJob = (
  state: WorkOrderState,
  stationId: StationId,
  cause: CycleCause,
  base: CommitSha | 'branch_base',
): JobSpec => {
  const station = requireStation(state, stationId);
  const n = cyclesOf(state, stationId) + 1;
  return station.kind === 'inspection'
    ? { kind: 'run_inspection', stationId, n, cause, base }
    : { kind: 'run_operator_station', stationId, n, cause, base };
};

// An Andon the Supervisor holds gets one `publish_blocked` job for it, so the
// branch and a draft `[BLOCKED]` PR are there for inspection. The job runs once per Andon, whatever it
// finds (no changes, a failure), so the Supervisor is never looped. Then the Supervisor decides.
const supervisorRow = (
  state: WorkOrderState,
  open: NonNullable<WorkOrderState['andon']>,
): Next => {
  if (state.blockedPr?.andonAt === open.at) {
    return { kind: 'await_supervisor', cause: 'andon' };
  }
  return {
    kind: 'job',
    job: { kind: 'publish_blocked', andonAt: open.at },
  };
};

// Row 3: an open Andon. The Mechanic triages it while it has budget and no incident yet; an
// escalated Andon, or one whose Mechanic already recorded an incident, waits for the Supervisor.
const andonRow = (
  state: WorkOrderState,
  open: NonNullable<WorkOrderState['andon']>,
): Next => {
  if (open.triage === 'supervisor') {
    return supervisorRow(state, open);
  }
  if (state.incidents.some((incident) => incident.andonAt === open.at)) {
    return supervisorRow(state, open);
  }
  if (state.mechanicRuns >= MECHANIC_BUDGET) return { kind: 'escalate_andon' };
  return {
    kind: 'job',
    job: { kind: 'mechanic', andonAt: open.at, n: state.mechanicRuns + 1 },
  };
};

// Row 5: answer a `resumed` or `reopened` before looking at the old Cycle again.
const resumeRow = (state: WorkOrderState): Next | undefined => {
  const pending = state.pendingResume;
  if (!pending) return undefined;
  const from = pending.fromCycle
    ? requireCycle(state, pending.fromCycle)
    : undefined;
  const cause: CycleCause = from
    ? { kind: 'resume', of: from.cycleId, resumeId: pending.resumeId }
    : { kind: 'resume', resumeId: pending.resumeId };
  const base =
    pending.baseCommit ??
    (from ? (from.commit ?? from.baseCommit) : checkpointBase(state));
  return {
    kind: 'job',
    job: stationJob(state, pending.forStation, cause, base),
  };
};

const handoverRow = (state: WorkOrderState, last: CycleState): Next => {
  const station = requireStation(state, last.stationId);
  if (
    usedOf(state.lostRestartsUsed, last.stationId) >= station.maxLostRestarts
  ) {
    return andon(
      'restart_failed',
      `handover budget of ${last.stationId} spent`,
    );
  }
  return {
    kind: 'job',
    job: stationJob(
      state,
      last.stationId,
      { kind: 'handover', of: last.cycleId },
      last.commit ?? last.baseCommit,
    ),
  };
};

const judgedRow = (
  state: WorkOrderState,
  last: CycleState,
): Next | undefined => {
  if (last.outcome !== 'verdict_fail' && last.outcome !== 'inspection_fail') {
    return undefined;
  }
  const station = requireStation(state, last.stationId);
  if (!station.onFail) {
    return andon('no_retry', `${last.stationId} failed and declares no retry`);
  }
  const budget = station.onFail.max + usedOf(state.retryGrants, last.stationId);
  if (usedOf(state.retriesUsed, last.stationId) >= budget) {
    return andon(
      'retries_exhausted',
      `retry budget of ${last.stationId} spent`,
    );
  }
  return {
    kind: 'job',
    job: stationJob(
      state,
      station.onFail.retry,
      { kind: 'retry', feedbackFrom: last.cycleId },
      checkpointBase(state),
    ),
  };
};

const infraRow = (
  state: WorkOrderState,
  last: CycleState,
): Next | undefined => {
  if (!last.outcome || !INFRA_OUTCOMES.includes(last.outcome)) return undefined;
  const station = requireStation(state, last.stationId);
  const lost = last.outcome === 'lost';
  const used = lost
    ? usedOf(state.lostRestartsUsed, last.stationId)
    : usedOf(state.restartsUsed, last.stationId);
  const limit = lost ? station.maxLostRestarts : station.maxRestarts;
  if (used >= limit) {
    return andon('restart_failed', `restart budget of ${last.stationId} spent`);
  }
  return {
    kind: 'job',
    job: stationJob(
      state,
      last.stationId,
      { kind: 'restart', of: last.cycleId },
      last.baseCommit,
    ),
  };
};

/**
 * Decides what runs next for a Work order. Rows are checked top to bottom, first match
 * wins; the numbered comments are the row numbers of the table. Pure: it reads only the state.
 */
export const nextJob = (state: WorkOrderState): Next => {
  // 1
  if (state.phase.kind === 'delivered' || state.phase.kind === 'cancelled') {
    return { kind: 'done' };
  }
  // 2
  if (state.activeJob) return { kind: 'busy' };
  // 3
  if (state.andon) return andonRow(state, state.andon);
  // 4
  if (state.workspaceFailures.length >= 2) return workspaceAndon(state);
  // 4b: the worktree keeps going missing on the Cells that pick the Work order up
  if ((state.worktreeResets ?? 0) >= MAX_WORKTREE_RESETS) {
    return andon(
      'workspace_failed',
      `worktree missing on ${state.worktreeResets} job(s) past Station 0 without a delivery`,
    );
  }
  // 5
  const resume = resumeRow(state);
  if (resume) return resume;

  const last = latestCycle(state);
  if (last) {
    // 6
    if (last.status === 'blocked') {
      return andon('cycle_blocked', `cycle ${last.cycleId} is blocked`);
    }
    // 7-8
    if (last.status === 'handed_over') return handoverRow(state, last);
    if (last.status === 'failed') {
      // 9-11
      const judged = judgedRow(state, last);
      if (judged) return judged;
      // 12-13
      const infra = infraRow(state, last);
      if (infra) return infra;
    }
  }
  // 14
  if (state.deliveryFailed) {
    return andon('delivery_failed', state.deliveryFailed.detail);
  }
  // 15
  if (state.phase.kind === 'stations') {
    const station = stationAt(state.line, state.phase.index);
    if (!station) {
      throw new Error(`phase index ${state.phase.index} is past the line`);
    }
    return {
      kind: 'job',
      job: stationJob(
        state,
        station.id,
        { kind: 'first' },
        checkpointBase(state),
      ),
    };
  }
  // 16
  if (!state.checkpoint) {
    throw new Error('a delivering Work order has no checkpoint');
  }
  return {
    kind: 'job',
    job: { kind: 'deliver', base: state.checkpoint.commit },
  };
};
