export const DESIRED_STATES = ['running', 'stopped'] as const;

export const RUNTIME_STATUSES = [
  'starting',
  'running',
  'stopping',
  'stopped',
  'failed',
] as const;

export type DesiredState = (typeof DESIRED_STATES)[number];

export type RuntimeStatus = (typeof RUNTIME_STATUSES)[number];

export const isDesiredState = (value: string): value is DesiredState =>
  (DESIRED_STATES as readonly string[]).includes(value);
