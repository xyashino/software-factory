import { z } from 'zod';

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

export const WORK_ORDER_ACTIONS = [
  'pause',
  'unpause',
  'resume',
  'reset_to_scratch',
  'reopen',
  'complete',
  'cancel',
] as const;

export const PLAN_STATES = [
  'draft',
  'branching',
  'active',
  'ready',
  'completed',
  'failed',
  'cancelled',
] as const;

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

export const ENTITY_TYPES = [
  'order_plan',
  'work_order',
  'order_step',
  'job',
  'incident',
  'cell',
] as const;

export const ACTOR_KINDS = [
  'supervisor',
  'mechanic',
  'cell',
  'system',
] as const;

const CONFLICT_CODES = [
  'rejected',
  'stale_epoch',
  'not_live',
  'precondition',
  'already_applied',
] as const;

export const projectIdSchema = z.string().trim().min(1);

export const slugSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'must be a lowercase slug');

export const idParams = z.object({ id: z.string().trim().min(1) });

export const invalidReply = z.object({
  code: z.literal(400),
  type: z.literal('invalid'),
  message: z.string(),
});

export const unauthorizedReply = z.object({
  code: z.literal(401),
  type: z.literal('unauthorized'),
  message: z.string(),
});

export const conflictReply = z.object({
  code: z.literal(409),
  type: z.enum(CONFLICT_CODES),
  message: z.string(),
});

export const internalReply = z.object({
  code: z.literal(500),
  type: z.literal('internal'),
  message: z.string(),
});

export const errorReplies = {
  400: invalidReply,
  401: unauthorizedReply,
  409: conflictReply,
  500: internalReply,
};
