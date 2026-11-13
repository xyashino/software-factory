import type { WorkerId, OrderId, ProjectId, StationId, TodoId } from '../ids';
import { findStation, stationIndex } from '../line/snapshot';
import type { AndonReason, JobKind } from './events';
import { latestCycle } from './evolve-helpers';
import type { Next } from './next';
import { type BoardStatus, type Holder, boardStatus, holderOf } from './status';
import type { Priority, WorkOrderState } from './state';

/** A workspace failure keeps its worker out of the queue for this long (CORE §8). A core constant. */
export const WORKSPACE_COOLDOWN_MS = 10 * 60 * 1000;

/**
 * Inputs `toProjection` cannot derive from the Work order's own events. `next` is the output of
 * `nextJob` (a later todo), so the caller supplies it; `lastSeq` and the times come from the store.
 */
export interface ProjectionMeta {
  lastSeq: number;
  createdAt: number;
  updatedAt: number;
  next: Next;
}

/** One row of the `orders` table (STORAGE §4), with typed values. The adapter serialises JSON columns. */
export interface OrderProjection {
  orderId: OrderId;
  projectId: ProjectId;
  todoId: TodoId;
  title: string;
  line: string;
  priority: Priority;
  dependsOn: OrderId[];
  lastSeq: number;
  status: BoardStatus;
  holder: Holder['kind'];
  nextKind: Next['kind'];
  jobKind: JobKind | null;
  runner: string | null;
  requiredCapabilities: string[];
  stationId: StationId | null;
  stationIndex: number | null;
  progressed: boolean;
  resumed: boolean;
  lastWorkerId: WorkerId | null;
  avoidWorkers: { workerId: WorkerId; until: number }[];
  andonReason: AndonReason | null;
  prUrl: string | null;
  prState: 'open' | 'merged' | 'closed' | null;
  createdAt: number;
  updatedAt: number;
}

interface StationRef {
  id: StationId;
  index: number;
  runner: string | undefined;
  requires: string[];
}

/** The Station of the next job; else the Station the phase points at; undefined when there is none. */
const stationRef = (
  state: WorkOrderState,
  next: Next,
): StationRef | undefined => {
  const jobStation =
    next.kind === 'job' && next.job.kind !== 'deliver'
      ? next.job.stationId
      : undefined;
  const phaseStation =
    state.phase.kind === 'stations'
      ? state.line.stations[state.phase.index]?.id
      : undefined;
  const id = jobStation ?? phaseStation;
  if (!id) return undefined;
  const station = findStation(state.line, id);
  const index = stationIndex(state.line, id);
  if (!station || index === undefined) return undefined;
  return { id, index, runner: station.runner, requires: station.requires };
};

const avoidWorkersOf = (
  state: WorkOrderState,
): OrderProjection['avoidWorkers'] => {
  const until = new Map<WorkerId, number>();
  state.workspaceFailures.forEach((failure) => {
    until.set(
      failure.workerId,
      Math.max(
        until.get(failure.workerId) ?? 0,
        failure.at + WORKSPACE_COOLDOWN_MS,
      ),
    );
  });
  return [...until].map(([workerId, expires]) => ({
    workerId,
    until: expires,
  }));
};

const lastWorkerIdOf = (state: WorkOrderState): WorkerId | null =>
  latestCycle(state)?.workerId ??
  state.workspaceFailures[state.workspaceFailures.length - 1]?.workerId ??
  null;

/**
 * The `orders` row of a Work order (STORAGE §4). Pure and deterministic: rebuilding it from the
 * same events and `meta` gives the same row. Station columns follow the next job's Station, or the
 * Station the phase points at when no job names one.
 */
export const toProjection = (
  state: WorkOrderState,
  meta: ProjectionMeta,
): OrderProjection => {
  const next = meta.next;
  const station = stationRef(state, next);
  const runsOperator =
    next.kind === 'job' && next.job.kind === 'run_operator_station';
  return {
    orderId: state.orderId,
    projectId: state.projectId,
    todoId: state.todoId,
    title: state.spec.title,
    line: state.line.name,
    priority: state.priority,
    dependsOn: state.dependsOn,
    lastSeq: meta.lastSeq,
    status: boardStatus(state),
    holder: holderOf(state).kind,
    nextKind: next.kind,
    jobKind: next.kind === 'job' ? next.job.kind : null,
    runner: runsOperator ? (station?.runner ?? null) : null,
    requiredCapabilities: station ? [...station.requires] : [],
    stationId: station?.id ?? null,
    stationIndex: station?.index ?? null,
    progressed: Object.values(state.lastPassed).some(
      (cycleId) => cycleId !== undefined,
    ),
    resumed: state.resumedWaiting,
    lastWorkerId: lastWorkerIdOf(state),
    avoidWorkers: avoidWorkersOf(state),
    andonReason: state.andon?.reason ?? null,
    prUrl: state.delivery?.prUrl ?? null,
    prState: state.delivery?.state ?? null,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
  };
};
