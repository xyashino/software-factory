import type { CellId } from '../ids';
import type { WorkOrderState } from './state';

export type Holder =
  | { kind: 'none' } // delivered or cancelled
  | { kind: 'cell'; cellId: CellId; epoch: number } // a job is active (including open questions)
  | { kind: 'supervisor'; cause: 'andon' }
  | { kind: 'queue' };

/**
 * Board status without the dependency overlay (`waiting_deps`, `deps_broken` need other Work
 * orders and are computed when the queue is read, STORAGE §4).
 */
export type BoardStatus =
  | 'queued'
  | 'running'
  | 'waiting_answer'
  | 'andon'
  | 'delivering'
  | 'delivered'
  | 'merged'
  | 'cancelled';

/** CORE §4.2: who holds the Work order right now. Derived, never stored as truth. */
export const holderOf = (state: WorkOrderState): Holder => {
  if (state.phase.kind === 'delivered' || state.phase.kind === 'cancelled')
    return { kind: 'none' };
  if (state.activeJob) {
    return {
      kind: 'cell',
      cellId: state.activeJob.cellId,
      epoch: state.activeJob.epoch,
    };
  }
  if (state.andon) return { kind: 'supervisor', cause: 'andon' };
  return { kind: 'queue' };
};

/** Board status (CORE §4.2): what a person sees on the board for this Work order. */
export const boardStatus = (state: WorkOrderState): BoardStatus => {
  if (state.phase.kind === 'cancelled') return 'cancelled';
  if (state.phase.kind === 'delivered')
    return state.delivery?.state === 'merged' ? 'merged' : 'delivered';
  if (state.activeJob) {
    if (state.questions.some((question) => question.status === 'open'))
      return 'waiting_answer';
    return state.activeJob.kind === 'deliver' ? 'delivering' : 'running';
  }
  if (state.andon) return 'andon';
  if (state.phase.kind === 'delivering') return 'delivering';
  return 'queued';
};
