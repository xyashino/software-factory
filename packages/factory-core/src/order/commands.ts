import { z } from 'zod';
import {
  blobRefSchema,
  commitShaSchema,
  cycleIdSchema,
  orderIdSchema,
  projectIdSchema,
  questionIdSchema,
  stationIdSchema,
  todoIdSchema,
  workerIdSchema,
  type BlobRef,
  type CycleId,
} from '../ids';
import {
  artifactsSchema,
  cycleFailureSchema,
  freeText,
  inspectionResultSchema,
  operatorSchema,
  pinnedLineSchema,
  priorities,
  prUrl,
  resumeModeSchema,
  shortText,
  specSchema,
  workspaceStageSchema,
  type Actor,
} from './events';

/** Payload shapes shared by several commands; free text and blobs follow the events they produce. */
const stationTarget = z.union([stationIdSchema, z.literal('supervisor')]);
const dependsOn = z.array(orderIdSchema).max(64);
const shaOrUndefined = commitShaSchema.optional();
const blobOrUndefined = blobRefSchema.optional();

const createOrderSchema = z
  .object({
    type: z.literal('CreateOrder'),
    projectId: projectIdSchema,
    todoId: todoIdSchema,
    spec: specSchema,
    priority: priorities,
    dependsOn,
    line: pinnedLineSchema,
    baseBranch: shortText,
  })
  .strict();
const updateSpecSchema = z
  .object({
    type: z.literal('UpdateSpec'),
    spec: specSchema,
    priority: priorities,
    dependsOn,
    line: pinnedLineSchema.optional(),
  })
  .strict();
const cancelSchema = z
  .object({ type: z.literal('Cancel'), reason: freeText })
  .strict();
const reprioritiseSchema = z
  .object({ type: z.literal('Reprioritise'), priority: priorities })
  .strict();
const claimJobSchema = z
  .object({ type: z.literal('ClaimJob'), workerId: workerIdSchema })
  .strict();
const startCycleSchema = z
  .object({
    type: z.literal('StartCycle'),
    baseCommit: commitShaSchema,
    operator: operatorSchema.optional(),
    promptBlob: blobOrUndefined,
  })
  .strict();
const reportWorkspaceFailedSchema = z
  .object({
    type: z.literal('ReportWorkspaceFailed'),
    stage: workspaceStageSchema,
    detail: freeText,
    logBlob: blobRefSchema,
  })
  .strict();
const completeCycleSchema = z
  .object({
    type: z.literal('CompleteCycle'),
    cycleId: cycleIdSchema,
    artifacts: artifactsSchema,
    commit: commitShaSchema,
  })
  .strict();
const submitVerdictSchema = z
  .object({
    type: z.literal('SubmitVerdict'),
    cycleId: cycleIdSchema,
    pass: z.boolean(),
    artifacts: artifactsSchema,
    feedbackBlob: blobOrUndefined,
    commit: shaOrUndefined,
  })
  .strict();
const reportInspectionSchema = z
  .object({
    type: z.literal('ReportInspection'),
    cycleId: cycleIdSchema,
    passed: z.boolean(),
    results: z.array(inspectionResultSchema).max(64),
  })
  .strict();
const failCycleSchema = z
  .object({
    type: z.literal('FailCycle'),
    cycleId: cycleIdSchema,
    reason: cycleFailureSchema,
    detail: freeText,
    wipCommit: shaOrUndefined,
  })
  .strict();
const blockCycleSchema = z
  .object({
    type: z.literal('BlockCycle'),
    cycleId: cycleIdSchema,
    source: z.enum(['operator', 'runtime']),
    reason: z.enum(['operator_reported', 'runner_prompt', 'question_timeout']),
    detail: freeText,
    handoverBlob: blobOrUndefined,
    commit: shaOrUndefined,
  })
  .strict();
const handOverCycleSchema = z
  .object({
    type: z.literal('HandOverCycle'),
    cycleId: cycleIdSchema,
    handoverBlob: blobRefSchema,
    commit: shaOrUndefined,
  })
  .strict();
const askQuestionSchema = z
  .object({
    type: z.literal('AskQuestion'),
    cycleId: cycleIdSchema,
    text: freeText,
  })
  .strict();
const answerSchema = z
  .object({
    type: z.literal('Answer'),
    questionId: questionIdSchema,
    text: freeText,
  })
  .strict();
const leaveNoteSchema = z
  .object({
    type: z.literal('LeaveNote'),
    cycleId: cycleIdSchema,
    to: stationTarget,
    text: freeText,
  })
  .strict();
const nudgeSchema = z
  .object({ type: z.literal('Nudge'), text: freeText })
  .strict();
const recordUsageSchema = z
  .object({
    type: z.literal('RecordUsage'),
    cycleId: cycleIdSchema,
    model: shortText,
    inputTokens: z.number().int().min(0),
    outputTokens: z.number().int().min(0),
    costUsd: z.number().min(0).optional(),
  })
  .strict();
const expireLeaseSchema = z.object({ type: z.literal('ExpireLease') }).strict();
const releaseJobSchema = z.object({ type: z.literal('ReleaseJob') }).strict();
const resumeSchema = z
  .object({
    type: z.literal('Resume'),
    mode: resumeModeSchema,
    noteBlob: blobOrUndefined,
    grantRetries: z.number().int().min(0).max(10).optional(),
  })
  .strict();
const reopenSchema = z
  .object({
    type: z.literal('Reopen'),
    stationId: stationIdSchema,
    noteBlob: blobOrUndefined,
  })
  .strict();
const reportDeliverySchema = z
  .object({
    type: z.literal('ReportDelivery'),
    result: z.discriminatedUnion('status', [
      z
        .object({
          status: z.literal('finished'),
          prUrl,
          commit: commitShaSchema,
        })
        .strict(),
      z.object({ status: z.literal('failed'), detail: freeText }).strict(),
    ]),
  })
  .strict();
const recordPrStateSchema = z
  .object({
    type: z.literal('RecordPrState'),
    prUrl,
    state: z.enum(['open', 'merged', 'closed']),
  })
  .strict();

/** Every command of CORE §5.2, discriminated by `type`. The payloads mirror the events they emit. */
export const orderCommandSchema = z.discriminatedUnion('type', [
  createOrderSchema,
  updateSpecSchema,
  cancelSchema,
  reprioritiseSchema,
  claimJobSchema,
  startCycleSchema,
  reportWorkspaceFailedSchema,
  completeCycleSchema,
  submitVerdictSchema,
  reportInspectionSchema,
  failCycleSchema,
  blockCycleSchema,
  handOverCycleSchema,
  askQuestionSchema,
  answerSchema,
  leaveNoteSchema,
  nudgeSchema,
  recordUsageSchema,
  expireLeaseSchema,
  releaseJobSchema,
  resumeSchema,
  reopenSchema,
  reportDeliverySchema,
  recordPrStateSchema,
]);

export type OrderCommand = z.infer<typeof orderCommandSchema>;
export type OrderCommandType = OrderCommand['type'];
export type CommandOf<T extends OrderCommandType> = Extract<
  OrderCommand,
  { type: T }
>;

/**
 * Why a command is refused (CORE §5.2). `stale_epoch` means the caller lost its lease and must stop
 * working on the Work order; `not_live` means its Cycle already ended.
 */
export type DomainError =
  | { code: 'not_found' }
  | { code: 'stale_epoch'; current: number }
  | { code: 'not_live'; cycleId: CycleId }
  | { code: 'precondition'; detail: string }
  | { code: 'invalid'; issues: string[] };

/** What `decide` may read besides the state and the command (CORE §5.1). Pure: no clock, no randomness. */
export interface DecideContext {
  now: number; // Factory clock
  ids: { next(): string }; // ULIDs, injected so tests are deterministic
  actor: Actor;
  epoch?: number; // the epoch the caller claims to hold
  blobs: { exists(ref: BlobRef): boolean; size(ref: BlobRef): number }; // pre-fetched by the runtime
}
