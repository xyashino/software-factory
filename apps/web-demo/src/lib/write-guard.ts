import type { WorkOrderState } from './view-model';

export const WRITE_ACTIONS = ['resume', 'cancel'] as const;

const RESUMABLE_STATES: readonly WorkOrderState[] = [
  'blocked',
  'line_unavailable',
];

const TERMINAL_STATES: readonly WorkOrderState[] = [
  'delivered',
  'completed',
  'cancelled',
];

export type WriteAction = (typeof WRITE_ACTIONS)[number];

export const isAllowedAction = (value: string): value is WriteAction =>
  (WRITE_ACTIONS as readonly string[]).includes(value);

export const isSameOrigin = (
  originHeader: string | null,
  requestUrl: string,
  hostHeader: string | null,
): boolean => {
  if (originHeader === null || hostHeader === null) return false;
  try {
    const expected = `${new URL(requestUrl).protocol}//${hostHeader}`;
    return new URL(originHeader).origin === new URL(expected).origin;
  } catch {
    return false;
  }
};

export const canResume = (state: WorkOrderState): boolean =>
  RESUMABLE_STATES.includes(state);

export const canCancel = (state: WorkOrderState): boolean =>
  !TERMINAL_STATES.includes(state);
