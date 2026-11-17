import { jobIdSchema, planBranchOf, type OrderId, type TodoId } from '../ids';
import { err, ok, type Result } from '../result';
import type { Actor } from '../order/events';
import type { DecideContext, DomainError } from '../order/commands';
import type { PlanCommand } from './commands';
import type { PlanEvent, PlanJobKind } from './events';
import { planNextJob } from './next-job';
import type { PlanState } from './state';

export type PlanDecision = Result<PlanEvent[], DomainError>;

/** What `decide` reads for a plan: the Work order context without blobs. */
export type PlanDecideContext = Pick<
  DecideContext,
  'now' | 'ids' | 'actor' | 'epoch'
>;

const precondition = (detail: string): DomainError => ({
  code: 'precondition',
  detail,
});

const refusal = (error: DomainError): PlanDecision => err(error);

const requireActor = (
  ctx: PlanDecideContext,
  kinds: Actor['kind'][],
): DomainError | undefined =>
  kinds.includes(ctx.actor.kind)
    ? undefined
    : precondition(`actor ${ctx.actor.kind} may not run this command`);

// The epoch fence: the caller must hold the epoch of the plan's active job.
const fenced = (
  state: PlanState,
  ctx: PlanDecideContext,
):
  | { ok: true; job: NonNullable<PlanState['activeJob']> }
  | { ok: false; error: DomainError } => {
  const job = state.activeJob;
  if (!job || ctx.epoch !== job.epoch) {
    return { ok: false, error: { code: 'stale_epoch', current: state.epoch } };
  }
  return { ok: true, job };
};

const reportUnder = (
  state: PlanState,
  ctx: PlanDecideContext,
  kind: PlanJobKind,
): { ok: true } | { ok: false; error: DomainError } => {
  const denied = requireActor(ctx, ['cell']);
  if (denied) return { ok: false, error: denied };
  const job = fenced(state, ctx);
  if (!job.ok) return job;
  if (job.job.kind !== kind) {
    return {
      ok: false,
      error: precondition(`the active job is ${job.job.kind}, not ${kind}`),
    };
  }
  return { ok: true };
};

const PLAN_OPEN_PHASES = new Set(['branching', 'active', 'pr_open']);

/**
 * Decides the events a plan command produces. `state` is undefined before the plan
 * exists. Pure: ids come from `ctx`. The first refusal wins: existence, actor, epoch, preconditions.
 */
export const decidePlan = (
  state: PlanState | undefined,
  command: PlanCommand,
  ctx: PlanDecideContext,
): PlanDecision => {
  if (command.type === 'CreatePlan') {
    if (state) return refusal(precondition('the plan already exists'));
    const denied = requireActor(ctx, ['factory']);
    if (denied) return refusal(denied);
    return ok([
      {
        type: 'plan_created',
        projectId: command.projectId,
        slug: command.slug,
        branch: planBranchOf(command.slug),
        baseBranch: command.baseBranch,
      },
    ]);
  }
  if (!state) return refusal({ code: 'not_found' });

  switch (command.type) {
    case 'AddPlanMember':
      return addMember(state, command, ctx);
    case 'RecordMemberState': {
      const denied = requireActor(ctx, ['factory']);
      if (denied) return refusal(denied);
      const member = state.members.find((m) => m.orderId === command.orderId);
      if (!member)
        return refusal(precondition('the Work order is not a member'));
      if (member.state === command.state) {
        return refusal(precondition(`the member is already ${command.state}`));
      }
      return ok([
        {
          type: 'plan_member_state_changed',
          orderId: command.orderId,
          state: command.state,
        },
      ]);
    }
    case 'ClaimJob': {
      const denied = requireActor(ctx, ['factory']);
      if (denied) return refusal(denied);
      const next = planNextJob(state);
      if (next.kind !== 'job') {
        return refusal(precondition(`nextJob is ${next.kind}, not a job`));
      }
      return ok([
        {
          type: 'job_claimed',
          jobId: jobIdSchema.parse(ctx.ids.next()),
          kind: next.job.kind,
          cellId: command.cellId,
          epoch: state.epoch + 1,
        },
      ]);
    }
    case 'ReportPlanBranch': {
      const under = reportUnder(state, ctx, 'plan_branch');
      if (!under.ok) return refusal(under.error);
      return ok([{ type: 'plan_branch_created', commit: command.commit }]);
    }
    case 'ReportPlanPr': {
      const under = reportUnder(state, ctx, 'plan_pr');
      if (!under.ok) return refusal(under.error);
      if (state.members[0]?.state !== 'merged') {
        return refusal(precondition('the root member is not merged'));
      }
      return ok([{ type: 'plan_pr_opened', prUrl: command.prUrl }]);
    }
    case 'ReportPlanReady': {
      const under = reportUnder(state, ctx, 'plan_pr_ready');
      if (!under.ok) return refusal(under.error);
      if (!state.members.every((m) => m.state === 'merged')) {
        return refusal(precondition('a member is not merged'));
      }
      return ok([{ type: 'plan_pr_ready' }]);
    }
    case 'ReportPlanJobFailed': {
      const denied = requireActor(ctx, ['cell']);
      if (denied) return refusal(denied);
      const job = fenced(state, ctx);
      if (!job.ok) return refusal(job.error);
      return ok([
        {
          type: 'plan_job_failed',
          jobId: job.job.jobId,
          kind: job.job.kind,
          detail: command.detail,
        },
      ]);
    }
    case 'RecordPlanPrState':
      return recordPrState(state, command, ctx);
    case 'ExpireLease':
    case 'ReleaseJob': {
      const denied = requireActor(
        ctx,
        command.type === 'ExpireLease' ? ['factory'] : ['factory', 'cell'],
      );
      if (denied) return refusal(denied);
      // The command names the job and epoch it ends; the caller holds no epoch of its own here.
      const job = state.activeJob;
      if (!job || job.jobId !== command.jobId || job.epoch !== command.epoch) {
        return refusal({ code: 'stale_epoch', current: state.epoch });
      }
      return ok([
        {
          type: 'job_lost',
          jobId: command.jobId,
          epoch: command.epoch,
          reason:
            command.type === 'ExpireLease' ? 'lease_expired' : 'cell_left',
        },
      ]);
    }
    case 'Resume': {
      const denied = requireActor(ctx, ['supervisor']);
      if (denied) return refusal(denied);
      if (!state.andon)
        return refusal(precondition('the plan has no Andon to resume'));
      const by = ctx.actor.kind === 'supervisor' ? ctx.actor.name : command.by;
      return ok([
        {
          type: 'resumed',
          resumeId: command.resumeId,
          by,
          mode: { kind: 'retry_station' },
        },
      ]);
    }
    case 'Cancel':
      return cancelPlan(state, command, ctx);
  }
};

const addMember = (
  state: PlanState,
  command: Extract<PlanCommand, { type: 'AddPlanMember' }>,
  ctx: PlanDecideContext,
): PlanDecision => {
  const denied = requireActor(ctx, ['factory']);
  if (denied) return refusal(denied);
  if (!PLAN_OPEN_PHASES.has(state.phase.kind)) {
    return refusal(
      precondition(`the plan is ${state.phase.kind}; no member can be added`),
    );
  }
  if (state.members.some((m) => m.orderId === command.orderId)) {
    return refusal(precondition('the Work order is already a member'));
  }
  const last: OrderId | undefined =
    state.members[state.members.length - 1]?.orderId;
  if (command.after !== last) {
    return refusal(
      precondition(
        last === undefined
          ? 'the root has no predecessor: after must be absent'
          : `a member is added after the last member ${last}`,
      ),
    );
  }
  const todoId: TodoId = command.todoId;
  return ok([
    {
      type: 'plan_member_added',
      orderId: command.orderId,
      todoId,
      ...(command.after === undefined ? {} : { after: command.after }),
    },
  ]);
};

const recordPrState = (
  state: PlanState,
  command: Extract<PlanCommand, { type: 'RecordPlanPrState' }>,
  ctx: PlanDecideContext,
): PlanDecision => {
  const denied = requireActor(ctx, ['factory']);
  if (denied) return refusal(denied);
  if (!state.pr) return refusal(precondition('the plan has no PR'));
  if (state.pr.url !== command.prUrl) {
    return refusal(precondition('the PR is not the plan PR'));
  }
  if (state.pr.state === command.state) {
    return refusal(precondition(`the plan PR is already ${command.state}`));
  }
  const events: PlanEvent[] = [
    {
      type: 'plan_pr_state_changed',
      prUrl: command.prUrl,
      state: command.state,
    },
  ];
  if (command.state === 'merged') events.push({ type: 'plan_completed' });
  return ok(events);
};

const cancelPlan = (
  state: PlanState,
  command: Extract<PlanCommand, { type: 'Cancel' }>,
  ctx: PlanDecideContext,
): PlanDecision => {
  const denied = requireActor(ctx, ['supervisor']);
  if (denied) return refusal(denied);
  if (state.phase.kind === 'completed' || state.phase.kind === 'cancelled') {
    return refusal(precondition(`the plan is ${state.phase.kind}`));
  }
  const events: PlanEvent[] = [
    { type: 'plan_cancelled', reason: command.reason },
  ];
  const job = state.activeJob;
  if (job) {
    events.push({
      type: 'job_lost',
      jobId: job.jobId,
      epoch: job.epoch,
      reason: 'cancelled',
    });
  }
  return ok(events);
};
