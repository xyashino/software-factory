import { z } from 'zod';
import { isMachineIndependentId } from './machine-local';

const SLUG = /^[a-z0-9][a-z0-9-]{0,127}$/;
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const ORDER_ID = /^([a-z0-9][a-z0-9-]{0,127}):([a-z0-9][a-z0-9-]{0,127})$/;
const BLOB_REF = /^sha256:[0-9a-f]{64}$/;
const COMMIT_SHA = /^[0-9a-f]{40}$/;

const slug = z
  .string()
  .regex(SLUG)
  .refine(isMachineIndependentId, 'id must not name a machine-local value');

export const projectIdSchema = slug.brand<'ProjectId'>();
export const todoIdSchema = slug.brand<'TodoId'>();
export const orderIdSchema = z
  .string()
  .regex(ORDER_ID)
  .refine(isMachineIndependentId, 'id must not name a machine-local value')
  .brand<'OrderId'>();
export const stationIdSchema = slug.brand<'StationId'>();
export const workerIdSchema = z.string().regex(ULID).brand<'WorkerId'>();
export const jobIdSchema = z.string().regex(ULID).brand<'JobId'>();
export const cycleIdSchema = z.string().regex(ULID).brand<'CycleId'>();
export const resumeIdSchema = z.string().regex(ULID).brand<'ResumeId'>();
export const questionIdSchema = z.string().regex(ULID).brand<'QuestionId'>();
export const blobRefSchema = z.string().regex(BLOB_REF).brand<'BlobRef'>();
export const commitShaSchema = z
  .string()
  .regex(COMMIT_SHA)
  .brand<'CommitSha'>();

export type ProjectId = z.infer<typeof projectIdSchema>;
export type TodoId = z.infer<typeof todoIdSchema>;
export type OrderId = z.infer<typeof orderIdSchema>;
export type StationId = z.infer<typeof stationIdSchema>;
export type WorkerId = z.infer<typeof workerIdSchema>;
export type JobId = z.infer<typeof jobIdSchema>;
export type CycleId = z.infer<typeof cycleIdSchema>;
export type ResumeId = z.infer<typeof resumeIdSchema>;
export type QuestionId = z.infer<typeof questionIdSchema>;
export type BlobRef = z.infer<typeof blobRefSchema>;
export type CommitSha = z.infer<typeof commitShaSchema>;

/** `<projectId>:<todoId>`, the only way an OrderId is formed. */
export const orderIdOf = (projectId: ProjectId, todoId: TodoId): OrderId =>
  `${projectId}:${todoId}` as OrderId;

/** Splits an OrderId back into its parts. Undefined when the text is not an OrderId. */
export const parseOrderId = (
  text: string,
): { projectId: ProjectId; todoId: TodoId } | undefined => {
  const match = ORDER_ID.exec(text);
  if (!match) return undefined;
  return { projectId: match[1] as ProjectId, todoId: match[2] as TodoId };
};
