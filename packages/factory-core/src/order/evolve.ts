import type { JobId, StationId } from '../ids';
import type { LineSnapshot } from '../line/snapshot';
import type { OrderEvent, StoredEvent } from './events';
import {
  applyAndonRaised,
  applyReopened,
  applyResumed,
} from './evolve-control';
import { evolveCycleEvent } from './evolve-cycle';
import type { WorkOrderState } from './state';

type Created = Extract<OrderEvent, { type: 'order_created' }>;

/** Runs `change` only when the job named by an event is the one holding the Work order. */
const whenJobActive = (
  state: WorkOrderState,
  jobId: JobId,
  change: (state: WorkOrderState) => WorkOrderState,
): WorkOrderState => (state.activeJob?.jobId === jobId ? change(state) : state);

/** A per-Station counter for every Station of the Line, all at zero. */
const zeroCounters = (line: LineSnapshot): Record<StationId, number> =>
  Object.fromEntries(line.stations.map((station) => [station.id, 0]));

const createOrder = (stored: StoredEvent, ev: Created): WorkOrderState => ({
  orderId: stored.orderId,
  projectId: ev.projectId,
  todoId: ev.todoId,
  spec: ev.spec,
  priority: ev.priority,
  dependsOn: ev.dependsOn,
  line: ev.line.snapshot,
  phase: { kind: 'stations', index: 0 },
  cycles: [],
  lastPassed: {},
  retriesUsed: zeroCounters(ev.line.snapshot),
  retryGrants: zeroCounters(ev.line.snapshot),
  restartsUsed: zeroCounters(ev.line.snapshot),
  lostRestartsUsed: zeroCounters(ev.line.snapshot),
  notes: [],
  questions: [],
  epoch: 0,
  workspaceFailures: [],
  resumedWaiting: false,
});

const claimJob = (
  state: WorkOrderState,
  ev: Extract<OrderEvent, { type: 'job_claimed' }>,
): WorkOrderState => ({
  ...state,
  activeJob: {
    jobId: ev.jobId,
    kind: ev.kind,
    workerId: ev.workerId,
    epoch: ev.epoch,
    cycleId: ev.cycleId,
  },
  epoch: ev.epoch,
  resumedWaiting: false,
});

const failWorkspace = (
  state: WorkOrderState,
  ev: Extract<OrderEvent, { type: 'workspace_failed' }>,
  at: number,
): WorkOrderState => {
  const job = state.activeJob;
  if (job?.jobId !== ev.jobId) return state;
  return {
    ...state,
    activeJob: undefined,
    workspaceFailures: [
      ...state.workspaceFailures,
      { workerId: job.workerId, jobId: ev.jobId, at },
    ],
  };
};

const finishDelivery = (
  state: WorkOrderState,
  ev: Extract<OrderEvent, { type: 'delivery_finished' }>,
): WorkOrderState =>
  whenJobActive(state, ev.jobId, (active) => ({
    ...active,
    activeJob: undefined,
    phase: { kind: 'delivered' },
    delivery: { prUrl: ev.prUrl, commit: ev.commit, state: 'open' },
    workspaceFailures: [],
  }));

const failDelivery = (
  state: WorkOrderState,
  ev: Extract<OrderEvent, { type: 'delivery_failed' }>,
): WorkOrderState =>
  whenJobActive(state, ev.jobId, (active) => ({
    ...active,
    activeJob: undefined,
    deliveryFailed: { jobId: ev.jobId, detail: ev.detail },
    workspaceFailures: [],
  }));

const changePrState = (
  state: WorkOrderState,
  ev: Extract<OrderEvent, { type: 'pr_state_changed' }>,
): WorkOrderState =>
  state.delivery?.prUrl === ev.prUrl
    ? { ...state, delivery: { ...state.delivery, state: ev.state } }
    : state;

/**
 * Folds one stored event into a Work order's state (CORE §4.3). Pure: the input is never mutated.
 * A history must start with `order_created`; a second `order_created` is an error. Late facts about
 * a Cycle that is not live are inert (rule 1), so any history folds to a defined state.
 */
export const evolve = (
  state: WorkOrderState | undefined,
  stored: StoredEvent,
): WorkOrderState => {
  const ev = stored.event;
  if (state === undefined) {
    if (ev.type !== 'order_created')
      throw new Error(`a Traveler starts with order_created, not ${ev.type}`);
    return createOrder(stored, ev);
  }
  switch (ev.type) {
    case 'order_created':
      throw new Error('order_created on an existing Work order');
    case 'spec_updated':
      return {
        ...state,
        spec: ev.spec,
        priority: ev.priority,
        dependsOn: ev.dependsOn,
        line: ev.line?.snapshot ?? state.line,
      };
    case 'priority_changed':
      return { ...state, priority: ev.priority };
    case 'cancelled':
      return {
        ...state,
        phase: { kind: 'cancelled', reason: ev.reason },
        activeJob: undefined,
      };
    case 'job_claimed':
      return claimJob(state, ev);
    case 'job_lost':
      return whenJobActive(state, ev.jobId, (active) => ({
        ...active,
        activeJob: undefined,
      }));
    case 'workspace_failed':
      return failWorkspace(state, ev, stored.at);
    case 'delivery_finished':
      return finishDelivery(state, ev);
    case 'delivery_failed':
      return failDelivery(state, ev);
    case 'pr_state_changed':
      return changePrState(state, ev);
    case 'andon_raised':
      return applyAndonRaised(state, ev, stored.at);
    case 'resumed':
      return applyResumed(state, ev);
    case 'reopened':
      return applyReopened(state, ev);
    case 'cycle_started':
    case 'cycle_completed':
    case 'verdict_recorded':
    case 'inspection_finished':
    case 'cycle_failed':
    case 'cycle_blocked':
    case 'cycle_handed_over':
    case 'usage_recorded':
    case 'question_asked':
    case 'question_answered':
    case 'question_abandoned':
    case 'note_left':
    case 'nudged':
      return evolveCycleEvent(state, stored, ev);
  }
};
