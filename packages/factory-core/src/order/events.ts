import { z } from 'zod';
import { lineSnapshotSchema } from '../line/snapshot';
import {
  blobRefSchema,
  cellIdSchema,
  commitShaSchema,
  cycleIdSchema,
  jobIdSchema,
  orderIdSchema,
  projectIdSchema,
  questionIdSchema,
  resumeIdSchema,
  stationIdSchema,
  todoIdSchema,
} from '../ids';
import {
  isMachineIndependentId,
  isMachineIndependentText,
} from '../machine-local';

const MAX_TEXT_BYTES = 4096;
const MAX_TAIL_BYTES = 2048;
const MAX_NAME_CHARS = 256;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const TAG = /^[a-z0-9][a-z0-9_-]{0,63}$/;
/** `prUrl` is the documented I2 exception: a GitHub https URL, checked for shape only. */
const HTTPS_URL = /^https:\/\/[^\s]{1,500}$/;
const TEXT_ENCODER = new TextEncoder();

const byteLength = (text: string): number => TEXT_ENCODER.encode(text).length;
const tagText = z
  .string()
  .regex(TAG)
  .refine(isMachineIndependentId, 'tag must not name a machine-local value');
const artifactKeyText = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._-]{0,63}$/)
  .refine(isMachineIndependentId, 'key must not name a machine-local value');

/** Free text: at most 4 KiB of UTF-8 and machine independent. Larger content is a blob. */
export const freeText = z
  .string()
  .refine(
    (text) => byteLength(text) <= MAX_TEXT_BYTES,
    'free text is capped at 4 KiB',
  )
  .refine(
    isMachineIndependentText,
    'free text must not contain machine-local values',
  );
/** An inspection tail: at most 2 KiB of UTF-8, machine independent. */
const tailText = z
  .string()
  .refine(
    (text) => byteLength(text) <= MAX_TAIL_BYTES,
    'tail is capped at 2 KiB',
  )
  .refine(
    isMachineIndependentText,
    'tail must not contain machine-local values',
  );
/** A name, tag or short label. */
export const shortText = z
  .string()
  .min(1)
  .max(MAX_NAME_CHARS)
  .refine(
    isMachineIndependentText,
    'name must not contain machine-local values',
  );
const contentHash = z.string().regex(SHA256);
export const prUrl = z.string().regex(HTTPS_URL);
const nonNegativeInt = z.number().int().min(0);
const positiveInt = z.number().int().min(1);

export const priorities = z.enum(['high', 'medium', 'low']);
const changeTypes = z.enum([
  'feat',
  'fix',
  'chore',
  'refactor',
  'docs',
  'test',
  'perf',
  'build',
  'ci',
  'style',
  'revert',
]);
export const specSchema = z
  .object({
    title: freeText,
    type: changeTypes,
    bodyBlob: blobRefSchema,
    contentHash,
  })
  .strict();
export const pinnedLineSchema = z
  .object({
    name: tagText,
    hash: z.string().regex(SHA256),
    snapshotBlob: blobRefSchema,
    snapshot: lineSnapshotSchema,
  })
  .strict()
  .refine(
    (line) =>
      line.name === line.snapshot.name && line.hash === line.snapshot.hash,
    'line name and hash must match the snapshot',
  );
export const artifactsSchema = z.record(artifactKeyText, blobRefSchema);
export const jobKindSchema = z.enum([
  'run_operator_station',
  'run_inspection',
  'deliver',
]);
export const workspaceStageSchema = z.enum([
  'fetch',
  'sync',
  'worktree',
  'setup',
]);
export const cycleFailureSchema = z.enum([
  'timed_out',
  'crashed',
  'stalled',
  'start_failed',
  'lost',
]);
const andonReasonSchema = z.enum([
  'cycle_blocked',
  'retries_exhausted',
  'no_retry',
  'restart_failed',
  'workspace_failed',
  'delivery_failed',
]);
export const resumeModeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('retry_station') }).strict(),
  z
    .object({ kind: z.literal('restart_from'), stationId: stationIdSchema })
    .strict(),
]);
export const cycleCauseSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('first') }).strict(),
  z.object({ kind: z.literal('retry'), feedbackFrom: cycleIdSchema }).strict(),
  z.object({ kind: z.literal('restart'), of: cycleIdSchema }).strict(),
  z.object({ kind: z.literal('handover'), of: cycleIdSchema }).strict(),
  z
    .object({
      kind: z.literal('resume'),
      of: cycleIdSchema.optional(),
      resumeId: resumeIdSchema,
    })
    .strict(),
]);
export const inspectionResultSchema = z
  .object({
    command: freeText,
    exitCode: z.number().int().nullable(),
    timedOut: z.boolean(),
    durationMs: nonNegativeInt,
    tail: tailText,
    logBlob: blobRefSchema,
  })
  .strict();
export const operatorSchema = z
  .object({ profile: shortText, runner: shortText, model: shortText })
  .strict();
export const actorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('factory') }).strict(),
  z.object({ kind: z.literal('cell'), cellId: cellIdSchema }).strict(),
  z
    .object({
      kind: z.literal('operator'),
      cellId: cellIdSchema,
      cycleId: cycleIdSchema,
    })
    .strict(),
  z.object({ kind: z.literal('supervisor'), name: shortText }).strict(),
]);

const orderCreatedSchema = z
  .object({
    type: z.literal('order_created'),
    projectId: projectIdSchema,
    todoId: todoIdSchema,
    spec: specSchema,
    priority: priorities,
    dependsOn: z.array(orderIdSchema).max(64),
    line: pinnedLineSchema,
    baseBranch: shortText,
  })
  .strict();
const specUpdatedSchema = z
  .object({
    type: z.literal('spec_updated'),
    spec: specSchema,
    priority: priorities,
    dependsOn: z.array(orderIdSchema).max(64),
    line: pinnedLineSchema.optional(),
  })
  .strict();
const priorityChangedSchema = z
  .object({ type: z.literal('priority_changed'), priority: priorities })
  .strict();
const cancelledSchema = z
  .object({ type: z.literal('cancelled'), reason: freeText })
  .strict();

const jobClaimedSchema = z
  .object({
    type: z.literal('job_claimed'),
    jobId: jobIdSchema,
    kind: jobKindSchema,
    cellId: cellIdSchema,
    epoch: positiveInt,
    cycleId: cycleIdSchema.optional(),
  })
  .strict();
const jobLostSchema = z
  .object({
    type: z.literal('job_lost'),
    jobId: jobIdSchema,
    epoch: positiveInt,
    reason: z.enum(['lease_expired', 'cell_left', 'cancelled']),
  })
  .strict();
const workspaceFailedSchema = z
  .object({
    type: z.literal('workspace_failed'),
    jobId: jobIdSchema,
    stage: workspaceStageSchema,
    detail: freeText,
    logBlob: blobRefSchema,
  })
  .strict();

const cycleStartedSchema = z
  .object({
    type: z.literal('cycle_started'),
    cycleId: cycleIdSchema,
    jobId: jobIdSchema,
    stationId: stationIdSchema,
    n: positiveInt,
    cause: cycleCauseSchema,
    baseCommit: commitShaSchema,
    operator: operatorSchema.optional(),
    promptBlob: blobRefSchema.optional(),
  })
  .strict();
const cycleCompletedSchema = z
  .object({
    type: z.literal('cycle_completed'),
    cycleId: cycleIdSchema,
    artifacts: artifactsSchema,
    commit: commitShaSchema,
  })
  .strict();
const verdictRecordedSchema = z
  .object({
    type: z.literal('verdict_recorded'),
    cycleId: cycleIdSchema,
    pass: z.boolean(),
    artifacts: artifactsSchema,
    feedbackBlob: blobRefSchema.optional(),
    commit: commitShaSchema.optional(),
  })
  .strict()
  .refine(
    (event) => event.pass || event.feedbackBlob !== undefined,
    'a failing verdict needs feedbackBlob',
  );
const inspectionFinishedSchema = z
  .object({
    type: z.literal('inspection_finished'),
    cycleId: cycleIdSchema,
    passed: z.boolean(),
    results: z.array(inspectionResultSchema).max(64),
  })
  .strict();
const cycleFailedSchema = z
  .object({
    type: z.literal('cycle_failed'),
    cycleId: cycleIdSchema,
    reason: cycleFailureSchema,
    detail: freeText,
    wipCommit: commitShaSchema.optional(),
  })
  .strict();
const cycleBlockedSchema = z
  .object({
    type: z.literal('cycle_blocked'),
    cycleId: cycleIdSchema,
    source: z.enum(['operator', 'runtime']),
    reason: z.enum(['operator_reported', 'runner_prompt', 'question_timeout']),
    detail: freeText,
    handoverBlob: blobRefSchema.optional(),
    commit: commitShaSchema.optional(),
  })
  .strict()
  .refine(
    (event) => event.source !== 'operator' || event.handoverBlob !== undefined,
    'an operator block needs handoverBlob',
  );
const cycleHandedOverSchema = z
  .object({
    type: z.literal('cycle_handed_over'),
    cycleId: cycleIdSchema,
    handoverBlob: blobRefSchema,
    commit: commitShaSchema.optional(),
  })
  .strict();
const usageRecordedSchema = z
  .object({
    type: z.literal('usage_recorded'),
    cycleId: cycleIdSchema,
    model: shortText,
    inputTokens: nonNegativeInt,
    outputTokens: nonNegativeInt,
    costUsd: z.number().min(0).optional(),
  })
  .strict();

const questionAskedSchema = z
  .object({
    type: z.literal('question_asked'),
    cycleId: cycleIdSchema,
    questionId: questionIdSchema,
    text: freeText,
  })
  .strict();
const questionAnsweredSchema = z
  .object({
    type: z.literal('question_answered'),
    questionId: questionIdSchema,
    by: shortText,
    text: freeText,
  })
  .strict();
const questionAbandonedSchema = z
  .object({
    type: z.literal('question_abandoned'),
    questionId: questionIdSchema,
  })
  .strict();
const noteLeftSchema = z
  .object({
    type: z.literal('note_left'),
    cycleId: cycleIdSchema,
    to: z.union([stationIdSchema, z.literal('supervisor')]),
    text: freeText,
  })
  .strict();
const nudgedSchema = z
  .object({
    type: z.literal('nudged'),
    cycleId: cycleIdSchema,
    by: shortText,
    text: freeText,
  })
  .strict();

const andonRaisedSchema = z
  .object({
    type: z.literal('andon_raised'),
    reason: andonReasonSchema,
    detail: freeText,
  })
  .strict();
const resumedSchema = z
  .object({
    type: z.literal('resumed'),
    resumeId: resumeIdSchema,
    by: shortText,
    mode: resumeModeSchema,
    noteBlob: blobRefSchema.optional(),
    grantRetries: z.number().int().min(1).max(10).optional(),
  })
  .strict();
const reopenedSchema = z
  .object({
    type: z.literal('reopened'),
    resumeId: resumeIdSchema,
    by: shortText,
    stationId: stationIdSchema,
    noteBlob: blobRefSchema.optional(),
  })
  .strict();

const deliveryFinishedSchema = z
  .object({
    type: z.literal('delivery_finished'),
    jobId: jobIdSchema,
    prUrl,
    commit: commitShaSchema,
  })
  .strict();
const deliveryFailedSchema = z
  .object({
    type: z.literal('delivery_failed'),
    jobId: jobIdSchema,
    detail: freeText,
  })
  .strict();
const prStateChangedSchema = z
  .object({
    type: z.literal('pr_state_changed'),
    prUrl,
    state: z.enum(['open', 'merged', 'closed']),
  })
  .strict();

/** Every event of CORE §3.3, discriminated by `type`. */
export const orderEventSchema = z.discriminatedUnion('type', [
  orderCreatedSchema,
  specUpdatedSchema,
  priorityChangedSchema,
  cancelledSchema,
  jobClaimedSchema,
  jobLostSchema,
  workspaceFailedSchema,
  cycleStartedSchema,
  cycleCompletedSchema,
  verdictRecordedSchema,
  inspectionFinishedSchema,
  cycleFailedSchema,
  cycleBlockedSchema,
  cycleHandedOverSchema,
  usageRecordedSchema,
  questionAskedSchema,
  questionAnsweredSchema,
  questionAbandonedSchema,
  noteLeftSchema,
  nudgedSchema,
  andonRaisedSchema,
  resumedSchema,
  reopenedSchema,
  deliveryFinishedSchema,
  deliveryFailedSchema,
  prStateChangedSchema,
]);

/** The envelope every stored event carries (CORE §3.1). Schema version 2 is the current one. */
export const storedEventSchema = z
  .object({
    schemaVersion: z.literal(2),
    seq: positiveInt,
    globalSeq: positiveInt,
    orderId: orderIdSchema,
    at: nonNegativeInt,
    actor: actorSchema,
    commandId: shortText,
    epoch: positiveInt.optional(),
    event: orderEventSchema,
  })
  .strict();

export type Actor = z.infer<typeof actorSchema>;
export type CycleCause = z.infer<typeof cycleCauseSchema>;
export type AndonReason = z.infer<typeof andonReasonSchema>;
export type ResumeMode = z.infer<typeof resumeModeSchema>;
export type JobKind = z.infer<typeof jobKindSchema>;
export type InspectionResult = z.infer<typeof inspectionResultSchema>;
export type Spec = z.infer<typeof specSchema>;
export type OrderEvent = z.infer<typeof orderEventSchema>;
export type OrderEventType = OrderEvent['type'];
export type StoredEvent = z.infer<typeof storedEventSchema>;
