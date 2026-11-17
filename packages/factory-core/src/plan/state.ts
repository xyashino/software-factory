import type {
  CellId,
  CommitSha,
  JobId,
  OrderId,
  PlanId,
  PlanSlug,
  ProjectId,
  TodoId,
} from '../ids';
import type { MemberState, PlanAndonReason, PlanJobKind } from './events';

/** Phases. `cancelled` is terminal, as is `completed`. */
export type PlanPhase =
  | { kind: 'branching' } // plan_created, no branch yet
  | { kind: 'active' } // the branch exists; no plan PR yet
  | { kind: 'pr_open' } // the draft plan PR exists and is not merged
  | { kind: 'ready' } // the plan PR was marked ready
  | { kind: 'completed' } // the plan PR was merged
  | { kind: 'cancelled'; reason: string };

/** One member, in chain order. `after` names the in-plan predecessor; absent for the root. */
export interface PlanMember {
  orderId: OrderId;
  todoId: TodoId;
  after?: OrderId;
  state: MemberState;
}

export interface PlanActiveJob {
  jobId: JobId;
  kind: PlanJobKind;
  cellId: CellId;
  epoch: number;
}

export interface PlanState {
  planId: PlanId;
  projectId: ProjectId;
  slug: PlanSlug;
  branch: string; // 'feat/<slug>'
  baseBranch: string; // the project's base branch when the plan was created
  phase: PlanPhase;
  members: PlanMember[]; // chain order, root first
  branchCommit?: CommitSha;
  pr?: { url: string; state: 'open' | 'merged' | 'closed' };
  activeJob?: PlanActiveJob;
  epoch: number; // the last issued epoch, 0 before any claim
  failures: { cellId: CellId; jobId: JobId; at: number }[]; // consecutive plan job failures
  andon?: { reason: PlanAndonReason; detail: string; at: number };
  resumedWaiting: boolean;
}
