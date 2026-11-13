import { z } from 'zod';

/** Why a task stopped. The engine only names reasons; it never performs the block. */
export const BLOCK_REASONS = [
  'retries_exhausted',
  'no_retry',
  'infra',
  'setup_failed',
  'runner_prompt',
  'question',
  'delivery_failed',
] as const;

export const blockReasonSchema = z.enum(BLOCK_REASONS);
export type BlockReason = z.infer<typeof blockReasonSchema>;

export const gateFailureSchema = z.strictObject({
  command: z.string(),
  exitCode: z.number().int().nullable(),
  timedOut: z.boolean(),
  tail: z.string(),
  logPath: z.string(),
});
export type GateFailure = z.infer<typeof gateFailureSchema>;

const attemptIdSchema = z.string().min(1);
const stepIdSchema = z.string().min(1);

/**
 * Every event the factory records. Validated with zod on write and on read:
 * a stored payload that no longer matches fails loudly, never silently.
 */
export const factoryEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('task_created'),
    workflow: z.string().min(1),
    todoPath: z.string().min(1),
    branch: z.string().min(1),
  }),
  z.strictObject({ type: z.literal('setup_started') }),
  z.strictObject({
    type: z.literal('setup_finished'),
    ok: z.boolean(),
    log: z.string(),
  }),
  z.strictObject({
    type: z.literal('attempt_started'),
    attemptId: attemptIdSchema,
    stepId: stepIdSchema,
    n: z.number().int().positive(),
    restartOf: attemptIdSchema.optional(),
    feedbackFrom: attemptIdSchema.optional(),
    snapshotRef: z.string().min(1),
    /** artifact key -> absolute path, for the in-pane CLI */
    artifacts: z.record(z.string(), z.string()),
  }),
  z.strictObject({
    type: z.literal('agent_ready'),
    attemptId: attemptIdSchema,
    pane: z.string(),
    tab: z.string(),
  }),
  z.strictObject({ type: z.literal('completed'), attemptId: attemptIdSchema }),
  z.strictObject({
    type: z.literal('verdict'),
    attemptId: attemptIdSchema,
    pass: z.boolean(),
    feedbackPath: z.string().optional(),
  }),
  z.strictObject({
    type: z.literal('gate_finished'),
    attemptId: attemptIdSchema,
    passed: z.boolean(),
    failures: z.array(gateFailureSchema),
  }),
  z.strictObject({
    type: z.literal('attempt_failed'),
    attemptId: attemptIdSchema,
    reason: z.enum(['timed_out', 'crashed', 'stalled', 'start_failed']),
    detail: z.string(),
  }),
  /** tokens and cost a headless runner reported; does not move the attempt */
  z.strictObject({
    type: z.literal('usage_recorded'),
    attemptId: attemptIdSchema,
    model: z.string().min(1),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    costUsd: z.number().nonnegative().optional(),
  }),
  z.strictObject({
    type: z.literal('reminder_sent'),
    attemptId: attemptIdSchema,
    kind: z.enum(['idle', 'silent']),
  }),
  z.strictObject({
    type: z.literal('question_asked'),
    attemptId: attemptIdSchema,
    questionId: z.string().min(1),
    to: z.enum(['operator', 'human']),
    text: z.string(),
  }),
  z.strictObject({
    type: z.literal('answered'),
    questionId: z.string().min(1),
    by: z.string(),
    text: z.string(),
  }),
  z.strictObject({
    type: z.literal('note'),
    attemptId: attemptIdSchema,
    to: z.string(),
    text: z.string(),
  }),
  z.strictObject({
    type: z.literal('blocked'),
    reason: blockReasonSchema,
    detail: z.string(),
  }),
  z.strictObject({
    type: z.literal('unblocked'),
    by: z.string(),
    /** text typed into the blocked pane */
    nudge: z.string().min(1).optional(),
    /** keys pressed in the blocked pane, e.g. the menu number then Enter */
    keys: z.array(z.string().min(1)).min(1).max(8).optional(),
    /** grants the step one retry beyond its budget */
    extraRetry: z.boolean().optional(),
  }),
  /** the operator (or a human) hands the incident over for a human to resolve */
  z.strictObject({ type: z.literal('escalated'), text: z.string().min(1) }),
  /** the supervisor typed a pending answer or nudge into the agent's pane */
  z.strictObject({
    type: z.literal('prompt_delivered'),
    attemptId: attemptIdSchema,
    kind: z.enum(['answer', 'nudge', 'keys']),
  }),
  /** the supervisor inspected the worktree after the operator attempt ended */
  z.strictObject({
    type: z.literal('operator_checked'),
    attemptId: attemptIdSchema,
    changed: z.boolean(),
  }),
  z.strictObject({
    type: z.literal('delivery_started'),
    to: z.enum(['new-pr', 'blocked-pr']),
  }),
  z.strictObject({ type: z.literal('delivered'), prUrl: z.string().min(1) }),
  /** a draft `[BLOCKED]` PR preserved the work; the task is parked */
  z.strictObject({
    type: z.literal('delivered_blocked'),
    prUrl: z.string().min(1),
  }),
  /** a final block with no PR to show for it: the task leaves the line */
  z.strictObject({ type: z.literal('parked') }),
  z.strictObject({ type: z.literal('delivery_failed'), detail: z.string() }),
]);

export type FactoryEvent = z.infer<typeof factoryEventSchema>;
export type FactoryEventType = FactoryEvent['type'];

/** An event with the time it was recorded. The engine reads `at`; it never reads a clock. */
export interface TimedEvent {
  at: number;
  event: FactoryEvent;
}
