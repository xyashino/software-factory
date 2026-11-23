export const PLAN_STATES = [
  'draft',
  'branching',
  'active',
  'ready',
  'completed',
  'failed',
  'cancelled',
] as const;

export const WORK_ORDER_STATES = [
  'waiting_parent',
  'queued',
  'paused',
  'running',
  'delivering',
  'delivered',
  'completed',
  'line_unavailable',
  'blocked',
  'cancelled',
] as const;

export const PRIORITIES = ['high', 'medium', 'low'] as const;

export const ORDER_TYPES = [
  'feat',
  'fix',
  'refactor',
  'chore',
  'docs',
  'test',
] as const;

export const PLAN_ACTIONS = [
  'activate',
  'retry',
  'complete',
  'cancel',
] as const;

export const WORK_ORDER_ACTIONS = [
  'pause',
  'unpause',
  'resume',
  'reset_to_scratch',
  'reopen',
  'complete',
  'cancel',
] as const;
