import type { CycleId, StationId } from '../ids';
import { stationIndex } from '../line/snapshot';
import type { CycleState, WorkOrderState } from './state';

export const requireIndex = (
  state: WorkOrderState,
  stationId: StationId,
): number => {
  const index = stationIndex(state.line, stationId);
  if (index === undefined) {
    throw new Error(`station ${stationId} is not in line ${state.line.name}`);
  }
  return index;
};

export const requireCycle = (
  state: WorkOrderState,
  cycleId: CycleId,
): CycleState => {
  const cycle = state.cycles.find((candidate) => candidate.cycleId === cycleId);
  if (!cycle) throw new Error(`cycle ${cycleId} is not in the history`);
  return cycle;
};

export const latestCycle = (state: WorkOrderState): CycleState | undefined =>
  state.cycles[state.cycles.length - 1];

/** CORE §4.3 rule 1: the Cycle is the latest one and still running. */
export const isLive = (state: WorkOrderState, cycleId: CycleId): boolean => {
  const last = latestCycle(state);
  return (
    last !== undefined && last.cycleId === cycleId && last.status === 'running'
  );
};

export const replaceCycle = (
  state: WorkOrderState,
  cycleId: CycleId,
  change: (cycle: CycleState) => CycleState,
): WorkOrderState => ({
  ...state,
  cycles: state.cycles.map((cycle) =>
    cycle.cycleId === cycleId ? change(cycle) : cycle,
  ),
});

/** Stops the question pause of a Cycle and adds its length to `pausedMs` (CORE §4.3 rule 6). */
export const stopPause = (cycle: CycleState, at: number): CycleState => {
  if (cycle.pausedSince === undefined) return cycle;
  return {
    ...cycle,
    pausedMs: cycle.pausedMs + Math.max(0, at - cycle.pausedSince),
    pausedSince: undefined,
  };
};

/** Terminal event of a Cycle: it ends, its pause stops, and the job it held ends (rule 2). */
export const endCycle = (
  state: WorkOrderState,
  cycleId: CycleId,
  at: number,
  patch: Partial<CycleState>,
): WorkOrderState => ({
  ...replaceCycle(state, cycleId, (cycle) =>
    stopPause({ ...cycle, ...patch, endedAt: at }, at),
  ),
  activeJob: undefined,
});

/** The Station the Andon concerns: the Station of the latest Cycle. */
export const andonStation = (state: WorkOrderState): StationId | undefined =>
  latestCycle(state)?.stationId;

/** Adds `amount` to a per-Station counter. */
export const bump = (
  counters: Record<StationId, number>,
  stationId: StationId,
  amount: number,
): Record<StationId, number> => ({
  ...counters,
  [stationId]: (counters[stationId] ?? 0) + amount,
});

export const resetCounter = (
  counters: Record<StationId, number>,
  stationId: StationId,
): Record<StationId, number> => ({
  ...counters,
  [stationId]: 0,
});
