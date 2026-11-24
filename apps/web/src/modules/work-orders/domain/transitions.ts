import type { WorkOrderAction, WorkOrderState } from './models';

const PAUSABLE_STATES: readonly WorkOrderState[] = ['queued', 'waiting_parent'];
const RESUMABLE_STATES: readonly WorkOrderState[] = [
  'blocked',
  'line_unavailable',
];
const TERMINAL_STATES: readonly WorkOrderState[] = [
  'delivered',
  'completed',
  'cancelled',
];

export const canPause = (state: WorkOrderState): boolean =>
  PAUSABLE_STATES.includes(state);

export const canUnpause = (state: WorkOrderState): boolean =>
  state === 'paused';

export const canResume = (state: WorkOrderState): boolean =>
  RESUMABLE_STATES.includes(state);

export const canCancel = (state: WorkOrderState): boolean =>
  !TERMINAL_STATES.includes(state);

export const availableActions = (state: WorkOrderState): WorkOrderAction[] => {
  const actions: WorkOrderAction[] = [];
  if (canResume(state)) actions.push('resume');
  if (canUnpause(state)) actions.push('unpause');
  if (canPause(state)) actions.push('pause');
  if (canCancel(state)) actions.push('cancel');
  return actions;
};
