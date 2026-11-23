export const INCIDENT_REASONS = [
  'line_unavailable',
  'step_retries_exhausted',
  'operator_blocked',
  'workspace_failed',
  'worktree_reset_limit',
  'delivery_failed',
  'parent_rebased',
] as const;

export const INCIDENT_STATUSES = [
  'open',
  'triaging',
  'resolved',
  'escalated',
  'cancelled',
] as const;
