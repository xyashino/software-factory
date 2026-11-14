import type { StoredPlanEvent } from './events';
import type { PlanState } from './state';

type Event = StoredPlanEvent['event'];

/** Applies one stored plan event to the state it follows (CORE §12.3 evolve rules). Pure. */
export const evolvePlan = (
  state: PlanState | undefined,
  stored: StoredPlanEvent,
): PlanState => {
  const ev = stored.event;
  if (ev.type === 'plan_created') {
    if (state) throw new Error('plan_created on an existing plan');
    return {
      planId: stored.planId,
      projectId: ev.projectId,
      slug: ev.slug,
      branch: ev.branch,
      baseBranch: ev.baseBranch,
      phase: { kind: 'branching' },
      members: [],
      epoch: 0,
      failures: [],
      resumedWaiting: false,
    };
  }
  if (!state)
    throw new Error(`a plan starts with plan_created, not ${ev.type}`);
  return apply(state, stored, ev);
};

const apply = (
  state: PlanState,
  stored: StoredPlanEvent,
  ev: Event,
): PlanState => {
  switch (ev.type) {
    case 'plan_created':
      throw new Error('plan_created on an existing plan');
    case 'plan_member_added':
      return {
        ...state,
        members: [
          ...state.members,
          {
            orderId: ev.orderId,
            todoId: ev.todoId,
            ...(ev.after === undefined ? {} : { after: ev.after }),
            state: 'open',
          },
        ],
      };
    case 'plan_member_state_changed':
      // A merged member never goes back: a later report for it is inert.
      return {
        ...state,
        members: state.members.map((member) =>
          member.orderId === ev.orderId && member.state !== 'merged'
            ? { ...member, state: ev.state }
            : member,
        ),
      };
    case 'plan_branch_created':
      return {
        ...state,
        phase: { kind: 'active' },
        branchCommit: ev.commit,
        activeJob: undefined,
        failures: [],
      };
    case 'plan_pr_opened':
      return {
        ...state,
        phase: { kind: 'pr_open' },
        pr: { url: ev.prUrl, state: 'open' },
        activeJob: undefined,
        failures: [],
      };
    case 'plan_pr_ready':
      return {
        ...state,
        phase: { kind: 'ready' },
        activeJob: undefined,
        failures: [],
      };
    case 'plan_pr_state_changed':
      return state.pr
        ? { ...state, pr: { url: state.pr.url, state: ev.state } }
        : state;
    case 'plan_completed':
      return { ...state, phase: { kind: 'completed' }, activeJob: undefined };
    case 'plan_cancelled':
      return { ...state, phase: { kind: 'cancelled', reason: ev.reason } };
    case 'job_claimed':
      return {
        ...state,
        activeJob: {
          jobId: ev.jobId,
          kind: ev.kind,
          cellId: ev.cellId,
          epoch: ev.epoch,
        },
        epoch: ev.epoch,
        resumedWaiting: false,
      };
    case 'job_lost':
      return state.activeJob?.jobId === ev.jobId
        ? { ...state, activeJob: undefined }
        : state;
    case 'plan_job_failed': {
      const active = state.activeJob;
      const failures =
        active && active.jobId === ev.jobId
          ? [
              ...state.failures,
              { cellId: active.cellId, jobId: ev.jobId, at: stored.at },
            ]
          : state.failures;
      return { ...state, activeJob: undefined, failures };
    }
    case 'andon_raised':
      return {
        ...state,
        andon: { reason: ev.reason, detail: ev.detail, at: stored.at },
      };
    case 'resumed': {
      const forgetsPr = state.andon?.reason === 'plan_pr_closed';
      return {
        ...state,
        andon: undefined,
        failures: [],
        resumedWaiting: true,
        ...(forgetsPr
          ? { pr: undefined, phase: { kind: 'active' as const } }
          : {}),
      };
    }
  }
};
