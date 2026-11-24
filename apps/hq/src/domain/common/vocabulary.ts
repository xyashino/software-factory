export const JOB_KINDS = [
  'plan_branch',
  'run_operator',
  'run_inspection',
  'deliver',
  'mechanic',
] as const;

export type JobKind = (typeof JOB_KINDS)[number];

export const JOB_STATUSES = [
  'ready',
  'claimed',
  'running',
  'passed',
  'failed',
  'blocked',
  'line_unavailable',
  'lost',
  'cancelled',
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export const WORKSPACE_MODES = ['fresh', 'reuse'] as const;

export type WorkspaceMode = (typeof WORKSPACE_MODES)[number];

export const ORDER_STEP_STATES = [
  'pending',
  'ready',
  'claimed',
  'running',
  'passed',
  'failed',
  'blocked',
  'cancelled',
] as const;

export type OrderStepState = (typeof ORDER_STEP_STATES)[number];

export const TOKEN_KINDS = [
  'supervisor',
  'web_join',
  'web_session',
  'factory_join',
  'factory_session',
] as const;

export type TokenKind = (typeof TOKEN_KINDS)[number];

export type FactoryProjectReport = {
  projectId: string;
  desired: number;
  running: number;
};
