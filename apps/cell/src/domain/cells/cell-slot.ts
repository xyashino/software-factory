import { RUNTIME_STATUSES } from '@repo/cell-contracts/enums/cells';

export const DESIRED_STATES = ['running', 'stopped'] as const;

const LIVE_STATUSES: readonly RuntimeStatus[] = [
  'starting',
  'running',
  'stopping',
];

export type DesiredState = (typeof DESIRED_STATES)[number];

export type RuntimeStatus = (typeof RUNTIME_STATUSES)[number];

export const isDesiredState = (value: string): value is DesiredState =>
  (DESIRED_STATES as readonly string[]).includes(value);

export const canStart = (status: RuntimeStatus): boolean =>
  !LIVE_STATUSES.includes(status);

export const canStop = (status: RuntimeStatus): boolean =>
  status === 'starting' || status === 'running';

export const canRemove = (status: RuntimeStatus): boolean =>
  !LIVE_STATUSES.includes(status);
