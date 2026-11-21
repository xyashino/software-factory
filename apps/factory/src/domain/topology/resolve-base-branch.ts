import type { PlanState, WorkOrderState } from '../orders/order-state';

export type PlanRef = {
  state: PlanState;
  baseBranch: string;
  branch: string;
  branchCommitSha: string | null;
};

export type ParentRef = {
  state: WorkOrderState;
  branch: string;
  headCommitSha: string | null;
};

export type BaseBranchSubject =
  | { kind: 'plan_init'; plan: PlanRef }
  | {
      kind: 'order';
      order: { baseBranch: string; branch: string };
      plan: PlanRef | null;
      parent: ParentRef | null;
    };

export type ResolvedBaseBranch = {
  isReady: boolean;
  initialState: 'queued' | 'waiting_parent';
  baseBranch: string;
  baseCommitSha: string | null;
  targetBranch: string;
};

const DELIVERED_STATES: readonly WorkOrderState[] = ['delivered', 'completed'];

const resolved = (
  isReady: boolean,
  baseBranch: string,
  baseCommitSha: string | null,
  targetBranch: string,
): ResolvedBaseBranch => ({
  isReady,
  initialState: isReady ? 'queued' : 'waiting_parent',
  baseBranch,
  baseCommitSha,
  targetBranch,
});

const resolveOrder = (
  order: { baseBranch: string; branch: string },
  plan: PlanRef | null,
  parent: ParentRef | null,
): ResolvedBaseBranch => {
  if (parent !== null)
    return resolved(
      DELIVERED_STATES.includes(parent.state),
      parent.branch,
      parent.headCommitSha,
      order.branch,
    );
  if (plan !== null)
    return resolved(
      plan.state === 'active',
      plan.branch,
      plan.branchCommitSha,
      order.branch,
    );
  return resolved(true, order.baseBranch, null, order.branch);
};

export const resolveBaseBranch = (
  subject: BaseBranchSubject,
): ResolvedBaseBranch => {
  switch (subject.kind) {
    case 'plan_init':
      return resolved(
        subject.plan.state === 'branching',
        subject.plan.baseBranch,
        null,
        subject.plan.branch,
      );
    case 'order':
      return resolveOrder(subject.order, subject.plan, subject.parent);
    default: {
      const _exhaustive: never = subject;
      return _exhaustive;
    }
  }
};
