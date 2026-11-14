import { asc } from 'drizzle-orm';
import type {
  CellId,
  CommitSha,
  OrderId,
  PlanId,
  PlanSlug,
  ProjectId,
  TodoId,
} from '@repo/factory-core/ids';
import type {
  PlanAndonReason,
  PlanJobKind,
  MemberState,
} from '@repo/factory-core/plan/events';
import type { PlanMember } from '@repo/factory-core/plan/state';
import type { PlanProjection } from '@repo/factory-core/plan/projection';
import type { PlanNext } from '@repo/factory-core/plan/next-job';
import type { FactoryDatabase } from './db';
import { type PlanRecord, plans } from './schema';

/** One `plans` row as read (STORAGE §4). JSON columns are strings. */
export type PlanRow = PlanRecord;

/** The row a plan projection is stored as. Pure serialisation: no fold, no domain decision. */
export const planRowOf = (projection: PlanProjection): PlanRow => ({
  planId: projection.planId,
  projectId: projection.projectId,
  slug: projection.slug,
  branch: projection.branch,
  baseBranch: projection.baseBranch,
  lastSeq: projection.lastSeq,
  phase: projection.phase,
  holder: projection.holder,
  nextKind: projection.nextKind,
  jobKind: projection.jobKind,
  members: JSON.stringify(
    projection.members.map((member) => ({
      orderId: member.orderId,
      todoId: member.todoId,
      ...(member.after === undefined ? {} : { after: member.after }),
      state: member.state,
    })),
  ),
  branchCommit: projection.branchCommit,
  prUrl: projection.prUrl,
  prState: projection.prState,
  lastCellId: projection.lastCellId,
  avoidCells: JSON.stringify(
    projection.avoidCells.map((avoid) => ({
      cellId: avoid.cellId,
      until: avoid.until,
    })),
  ),
  andonReason: projection.andonReason,
  createdAt: projection.createdAt,
  updatedAt: projection.updatedAt,
});

/** The projection a row holds. The inverse of `planRowOf`. */
export const projectionOfPlanRow = (row: PlanRow): PlanProjection => {
  const members = JSON.parse(row.members) as {
    orderId: string;
    todoId: string;
    after?: string;
    state: string;
  }[];
  const avoid = JSON.parse(row.avoidCells) as {
    cellId: string;
    until: number;
  }[];
  return {
    planId: row.planId as PlanId,
    projectId: row.projectId as ProjectId,
    slug: row.slug as PlanSlug,
    branch: row.branch,
    baseBranch: row.baseBranch,
    lastSeq: row.lastSeq,
    phase: row.phase as PlanProjection['phase'],
    holder: row.holder as PlanProjection['holder'],
    nextKind: row.nextKind as PlanNext['kind'],
    jobKind: row.jobKind as PlanJobKind | null,
    members: members.map((member): PlanMember => ({
      orderId: member.orderId as OrderId,
      todoId: member.todoId as TodoId,
      ...(member.after === undefined ? {} : { after: member.after as OrderId }),
      state: member.state as MemberState,
    })),
    branchCommit: row.branchCommit as CommitSha | null,
    prUrl: row.prUrl,
    prState: row.prState as PlanProjection['prState'],
    lastCellId: row.lastCellId as CellId | null,
    avoidCells: avoid.map((entry) => ({
      cellId: entry.cellId as CellId,
      until: entry.until,
    })),
    andonReason: row.andonReason as PlanAndonReason | null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
};

/** Writes a plan row: insert, or replace the row of the same plan (STORAGE §3 step 4). */
export const upsertPlan = (
  db: FactoryDatabase,
  projection: PlanProjection,
): void => {
  const row = planRowOf(projection);
  db.insert(plans)
    .values(row)
    .onConflictDoUpdate({ target: plans.planId, set: row })
    .run();
};

/** Every `plans` row as a projection, sorted by plan id. */
export const loadPlans = (db: FactoryDatabase): PlanProjection[] =>
  db
    .select()
    .from(plans)
    .orderBy(asc(plans.planId))
    .all()
    .map(projectionOfPlanRow);
