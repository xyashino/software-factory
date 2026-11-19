export const MAX_BODY_BYTES = 1024 * 1024;

export const MESSAGE_MAX_CHARS = 4096;

export const VERBS = [
  'done',
  'verdict',
  'block',
  'context',
  'read',
  'incident',
] as const;

export const ROLES = ['operator', 'mechanic'] as const;

export const INCIDENT_ACTIONS = [
  'retry_step',
  'restart_from_step',
  'restart_from_scratch',
  'escalate',
  'cancel',
] as const;

export const REPLY_CODES = [
  'invalid',
  'unauthorized',
  'rejected',
  'stale_epoch',
  'not_live',
  'precondition',
  'internal',
] as const;
