import type { CellId, CommitSha, PlanId, PlanSlug, ProjectId } from '../ids';
import { WORKSPACE_COOLDOWN_MS } from '../order/projection';
import type { PlanAndonReason, PlanJobKind } from './events';
import type { PlanNext } from './next-job';
import type { PlanMember, PlanPhase, PlanState } from './state';

/** Inputs `toProjection` cannot derive from the plan's events: `next` is `planNextJob` of the state. */
export interface PlanProjectionMeta {
  lastSeq: number;
  createdAt: number;
  updatedAt: number;
  next: PlanNext;
}

/** One row of the `plans` table, with typed values. */
export interface PlanProjection {
  planId: PlanId;
  projectId: ProjectId;
  slug: PlanSlug;
  branch: string;
  baseBranch: string;
  lastSeq: number;
  phase: PlanPhase['kind'];
  members: PlanMember[];
  branchCommit: CommitSha | null;
  prUrl: string | null;
  prState: 'open' | 'merged' | 'closed' | null;
  lastCellId: CellId | null;
  holder: 'queue' | 'cell' | 'supervisor' | 'members' | 'none';
  nextKind: PlanNext['kind'];
  jobKind: PlanJobKind | null;
  avoidCells: { cellId: CellId; until: number }[];
  andonReason: PlanAndonReason | null;
  createdAt: number;
  updatedAt: number;
}

const holderOf = (next: PlanNext): PlanProjection['holder'] => {
  switch (next.kind) {
    case 'done':
      return 'none';
    case 'wait_cell':
      return 'cell';
    case 'await_supervisor':
    case 'raise_andon':
      return 'supervisor';
    case 'wait_external':
      return 'members';
    case 'job':
      return 'queue';
  }
};

/**
 * The `plans` row of a plan. Pure: rebuilding it from the same events and
 * `meta` gives the same row. The row is a function of the plan's own events only.
 */
export const toPlanProjection = (
  state: PlanState,
  meta: PlanProjectionMeta,
): PlanProjection => ({
  planId: state.planId,
  projectId: state.projectId,
  slug: state.slug,
  branch: state.branch,
  baseBranch: state.baseBranch,
  lastSeq: meta.lastSeq,
  phase: state.phase.kind,
  members: state.members.map((member) => ({ ...member })),
  branchCommit: state.branchCommit ?? null,
  prUrl: state.pr?.url ?? null,
  prState: state.pr?.state ?? null,
  holder: holderOf(meta.next),
  nextKind: meta.next.kind,
  jobKind: meta.next.kind === 'job' ? meta.next.job.kind : null,
  lastCellId: state.activeJob?.cellId ?? state.failures.at(-1)?.cellId ?? null,
  avoidCells: state.failures.map((failure) => ({
    cellId: failure.cellId,
    until: failure.at + WORKSPACE_COOLDOWN_MS,
  })),
  andonReason: state.andon?.reason ?? null,
  createdAt: meta.createdAt,
  updatedAt: meta.updatedAt,
});
