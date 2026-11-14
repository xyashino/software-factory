import type { JobId } from '../ids';
import type { PlanAndonReason, PlanJobKind } from './events';
import type { PlanState } from './state';

/** CORE §12.3 `nextJob` for a plan. The concrete JobId and epoch are assigned on `ClaimJob`. */
export type PlanNext =
  | { kind: 'done' } // completed or cancelled
  | { kind: 'await_supervisor'; cause: 'andon' }
  | { kind: 'raise_andon'; reason: PlanAndonReason; detail: string }
  | { kind: 'wait_cell'; jobId: JobId; epoch: number }
  | { kind: 'wait_external' } // nothing to run until a member or the plan PR changes state
  | { kind: 'job'; job: { kind: PlanJobKind } };

const rootMerged = (state: PlanState): boolean =>
  state.members[0]?.state === 'merged';

const everyMemberMerged = (state: PlanState): boolean =>
  state.members.length > 0 &&
  state.members.every((member) => member.state === 'merged');

/**
 * CORE §12.3 table, rows 1 to 9, in order: the first matching row wins. Pure: a function of the
 * plan's own state, so the same state always gives the same next step.
 */
export const planNextJob = (state: PlanState): PlanNext => {
  const phase = state.phase.kind;
  if (phase === 'completed' || phase === 'cancelled') return { kind: 'done' };
  if (state.activeJob) {
    return {
      kind: 'wait_cell',
      jobId: state.activeJob.jobId,
      epoch: state.activeJob.epoch,
    };
  }
  if (state.andon) return { kind: 'await_supervisor', cause: 'andon' };
  if (state.failures.length >= 2) {
    return {
      kind: 'raise_andon',
      reason: 'plan_job_failed',
      detail: 'two plan jobs failed in a row',
    };
  }
  if (state.pr?.state === 'closed') {
    return {
      kind: 'raise_andon',
      reason: 'plan_pr_closed',
      detail: 'the plan PR was closed without merging',
    };
  }
  if (phase === 'branching')
    return { kind: 'job', job: { kind: 'plan_branch' } };
  if (phase === 'active' && rootMerged(state)) {
    return { kind: 'job', job: { kind: 'plan_pr' } };
  }
  if (phase === 'pr_open' && everyMemberMerged(state)) {
    return { kind: 'job', job: { kind: 'plan_pr_ready' } };
  }
  return { kind: 'wait_external' };
};

export { rootMerged, everyMemberMerged };
