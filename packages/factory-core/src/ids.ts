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
export const cellIdSchema = z.string().regex(ULID).brand<'CellId'>();
export const jobIdSchema = z.string().regex(ULID).brand<'JobId'>();
export const cycleIdSchema = z.string().regex(ULID).brand<'CycleId'>();
export const resumeIdSchema = z.string().regex(ULID).brand<'ResumeId'>();
export const questionIdSchema = z.string().regex(ULID).brand<'QuestionId'>();
export const incidentIdSchema = z.string().regex(ULID).brand<'IncidentId'>();
export const blobRefSchema = z.string().regex(BLOB_REF).brand<'BlobRef'>();
export const commitShaSchema = z
  .string()
  .regex(COMMIT_SHA)
  .brand<'CommitSha'>();

export type ProjectId = z.infer<typeof projectIdSchema>;
export type TodoId = z.infer<typeof todoIdSchema>;
export type OrderId = z.infer<typeof orderIdSchema>;
export type StationId = z.infer<typeof stationIdSchema>;
export type CellId = z.infer<typeof cellIdSchema>;
export type JobId = z.infer<typeof jobIdSchema>;
export type CycleId = z.infer<typeof cycleIdSchema>;
export type ResumeId = z.infer<typeof resumeIdSchema>;
export type QuestionId = z.infer<typeof questionIdSchema>;
export type IncidentId = z.infer<typeof incidentIdSchema>;
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

const PLAN_SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PLAN_ID = /^([a-z0-9][a-z0-9-]{0,127}):plan:([a-z0-9][a-z0-9-]{0,63})$/;

export const planSlugSchema = z.string().regex(PLAN_SLUG).brand<'PlanSlug'>();
export const planIdSchema = z
  .string()
  .regex(PLAN_ID)
  .refine(isMachineIndependentId, 'id must not name a machine-local value')
  .brand<'PlanId'>();

export type PlanSlug = z.infer<typeof planSlugSchema>;
export type PlanId = z.infer<typeof planIdSchema>;

/** `<projectId>:plan:<slug>`, the stream id of an Order Plan. */
export const planIdOf = (projectId: ProjectId, slug: PlanSlug): PlanId =>
  `${projectId}:plan:${slug}` as PlanId;

/** True for a PlanId, false for an OrderId. The two never collide: a PlanId has two colons. */
export const isPlanId = (text: string): text is PlanId => PLAN_ID.test(text);

/** Splits a PlanId back into its parts. Undefined when the text is not a PlanId. */
export const parsePlanId = (
  text: string,
): { projectId: ProjectId; slug: PlanSlug } | undefined => {
  const match = PLAN_ID.exec(text);
  if (!match) return undefined;
  return { projectId: match[1] as ProjectId, slug: match[2] as PlanSlug };
};

/** The plan branch name. */
export const planBranchOf = (slug: PlanSlug): string => `feat/${slug}`;
