import { cycleIdSchema, jobIdSchema } from '../ids';
import { err, ok } from '../result';
import type { CommandOf, DecideContext } from './commands';
import {
  type Decision,
  fenced,
  hasStarted,
  invalidIf,
  loseJob,
  missingBlobs,
  precondition,
  refuseIfTerminal,
  requireActor,
  supervisorIncident,
} from './decide-guards';
import type { OrderEvent } from './events';
import { holderOf } from './status';
import type { WorkOrderState } from './state';
import { nextJob } from './next-job';

/** Creates the Work order. The only command that runs without a state. */
export const createOrder = (
  state: WorkOrderState | undefined,
  command: CommandOf<'CreateOrder'>,
  ctx: DecideContext,
): Decision => {
  if (state) return err(precondition('the Work order already exists'));
  const denied = requireActor(ctx, ['factory']);
  if (denied) return err(denied);
  const events: OrderEvent[] = [
    {
      type: 'order_created',
      projectId: command.projectId,
      todoId: command.todoId,
      spec: command.spec,
      priority: command.priority,
      dependsOn: command.dependsOn,
      line: command.line,
      baseBranch: command.baseBranch,
      ...(command.plan === undefined ? {} : { plan: command.plan }),
    },
  ];
  return ok(events);
};

/** The spec may change until a job is first claimed (CORE §5.2). */
export const updateSpec = (
  state: WorkOrderState,
  command: CommandOf<'UpdateSpec'>,
  ctx: DecideContext,
): Decision => {
  const denied = requireActor(ctx, ['factory']) ?? refuseIfTerminal(state);
  if (denied) return err(denied);
  if (state.epoch > 0) {
    return err(precondition('a job was claimed, so the spec is frozen'));
  }
  const events: OrderEvent[] = [
    {
      type: 'spec_updated',
      spec: command.spec,
      priority: command.priority,
      dependsOn: command.dependsOn,
      line: command.line,
    },
  ];
  return ok(events);
};

/** Cancelling ends an active job too: its running Cycle fails as lost (CORE §5.2). */
export const cancel = (
  state: WorkOrderState,
  command: CommandOf<'Cancel'>,
  ctx: DecideContext,
): Decision => {
  const denied = requireActor(ctx, ['supervisor', 'mechanic', 'factory']);
  if (denied) return err(denied);
  if (state.phase.kind === 'delivered') {
    return err(precondition('a delivered Work order cannot be cancelled'));
  }
  if (state.phase.kind === 'cancelled') {
    return err(precondition('the Work order is already cancelled'));
  }
  // An Andon is not left without an incident, and the Mechanic records its own before it cancels.
  if (
    ctx.actor.kind === 'mechanic' &&
    state.andon &&
    !state.incidents.some((incident) => incident.andonAt === state.andon?.at)
  ) {
    return err(
      precondition('the mechanic records the incident before it cancels'),
    );
  }
  const job = state.activeJob;
  const ending = job
    ? loseJob(state, job, 'cancelled', 'the Work order was cancelled')
    : [];
  const events: OrderEvent[] = [
    ...supervisorIncident(state, ctx, 'cancel'),
    ...ending,
    { type: 'cancelled', reason: command.reason },
  ];
  return ok(events);
};

export const reprioritise = (
  state: WorkOrderState,
  command: CommandOf<'Reprioritise'>,
  ctx: DecideContext,
): Decision => {
  const denied = requireActor(ctx, ['supervisor']) ?? refuseIfTerminal(state);
  if (denied) return err(denied);
  return ok([{ type: 'priority_changed', priority: command.priority }]);
};

/** The claim endpoint: the queue hands the Work order's next job to a Cell (CORE §5.2, §6). */
export const claimJob = (
  state: WorkOrderState,
  command: CommandOf<'ClaimJob'>,
  ctx: DecideContext,
): Decision => {
  const denied = requireActor(ctx, ['factory']);
  if (denied) return err(denied);
  const holder = holderOf(state);
  const next = nextJob(state);
  // A blocked publish runs while the supervisor holds the Andon: it publishes, and the Andon stays theirs.
  const publishing =
    holder.kind === 'supervisor' &&
    next.kind === 'job' &&
    next.job.kind === 'publish_blocked';
  if (holder.kind !== 'queue' && holder.kind !== 'mechanic' && !publishing) {
    return err(precondition(`the Work order is held by ${holder.kind}`));
  }
  if (next.kind !== 'job') {
    return err(precondition(`nextJob is ${next.kind}, not a job`));
  }
  const jobId = jobIdSchema.parse(ctx.ids.next());
  const epoch = state.epoch + 1;
  const { kind } = next.job;
  if (
    next.job.kind === 'deliver' ||
    next.job.kind === 'mechanic' ||
    publishing
  ) {
    return ok([
      { type: 'job_claimed', jobId, kind, cellId: command.cellId, epoch },
    ]);
  }
  const cycleId = cycleIdSchema.parse(ctx.ids.next());
  return ok([
    {
      type: 'job_claimed',
      jobId,
      kind,
      cellId: command.cellId,
      epoch,
      cycleId,
    },
  ]);
};

export const reportWorkspaceFailed = (
  state: WorkOrderState,
  command: CommandOf<'ReportWorkspaceFailed'>,
  ctx: DecideContext,
): Decision => {
  const denied = requireActor(ctx, ['cell']);
  if (denied) return err(denied);
  const fence = fenced(state, ctx);
  if (!fence.ok) return fence;
  const job = fence.value;
  if (hasStarted(state, job)) {
    return err(precondition('the Cycle has already started'));
  }
  const problem = invalidIf(missingBlobs(ctx, [command.logBlob]));
  if (problem) return err(problem);
  return ok([
    {
      type: 'workspace_failed',
      jobId: job.jobId,
      stage: command.stage,
      detail: command.detail,
      logBlob: command.logBlob,
    },
  ]);
};

/**
 * The Cell's job needs a worktree this Cell does not hold (CORE §4.3 rule 13). Only a Work order past
 * its first Station can lack one: a Station 0 job creates its worktree from the base, so nothing is reset.
 */
export const reportWorktreeMissing = (
  state: WorkOrderState,
  command: CommandOf<'ReportWorktreeMissing'>,
  ctx: DecideContext,
): Decision => {
  const denied = requireActor(ctx, ['cell']);
  if (denied) return err(denied);
  const fence = fenced(state, ctx);
  if (!fence.ok) return fence;
  const job = fence.value;
  if (hasStarted(state, job)) {
    return err(precondition('the Cycle has already started'));
  }
  const progressed =
    state.phase.kind === 'delivering' ||
    (state.phase.kind === 'stations' && state.phase.index > 0);
  if (!progressed) {
    return err(
      precondition(
        'a missing worktree resets only a Work order past Station 0',
      ),
    );
  }
  return ok([
    { type: 'worktree_missing', jobId: job.jobId, detail: command.detail },
  ]);
};

/** The reaper found the lease expired: the job is lost (CORE §5.2). */
export const expireLease = (
  state: WorkOrderState,
  ctx: DecideContext,
): Decision => {
  const denied = requireActor(ctx, ['factory']);
  if (denied) return err(denied);
  const fence = fenced(state, ctx);
  if (!fence.ok) return fence;
  return ok(loseJob(state, fence.value, 'lease_expired', 'the lease expired'));
};

/** The Cell leaves its job on purpose; the job is lost as `cell_left` (CORE §5.2). */
export const releaseJob = (
  state: WorkOrderState,
  ctx: DecideContext,
): Decision => {
  const denied = requireActor(ctx, ['cell']);
  if (denied) return err(denied);
  const fence = fenced(state, ctx);
  if (!fence.ok) return fence;
  return ok(loseJob(state, fence.value, 'cell_left', 'the cell left the job'));
};

export const reportDelivery = (
  state: WorkOrderState,
  command: CommandOf<'ReportDelivery'>,
  ctx: DecideContext,
): Decision => {
  const denied = requireActor(ctx, ['cell']);
  if (denied) return err(denied);
  const fence = fenced(state, ctx);
  if (!fence.ok) return fence;
  const job = fence.value;
  if (job.kind !== 'deliver') {
    return err(precondition('the job is not a delivery'));
  }
  const { result } = command;
  if (result.status === 'finished') {
    return ok([
      {
        type: 'delivery_finished',
        jobId: job.jobId,
        prUrl: result.prUrl,
        commit: result.commit,
      },
    ]);
  }
  return ok([
    { type: 'delivery_failed', jobId: job.jobId, detail: result.detail },
  ]);
};

/**
 * The `publish_blocked` job reports what it did for the open Andon (v1 `publishBlockedWork`). The Andon keeps
 * its holder and its phase: the report only records the published PR, an empty worktree, or a failure.
 */
export const reportBlockedPr = (
  state: WorkOrderState,
  command: CommandOf<'ReportBlockedPr'>,
  ctx: DecideContext,
): Decision => {
  const denied = requireActor(ctx, ['cell']);
  if (denied) return err(denied);
  const fence = fenced(state, ctx);
  if (!fence.ok) return fence;
  const job = fence.value;
  if (job.kind !== 'publish_blocked') {
    return err(precondition('the job is not a blocked publish'));
  }
  const andon = state.andon;
  if (!andon) return err(precondition('no Andon is raised'));
  return ok([
    {
      type: 'blocked_pr_reported',
      jobId: job.jobId,
      andonAt: andon.at,
      result: command.result,
    },
  ]);
};

/** The PR state comes from the intake's polling; it is recorded once a PR exists (CORE §5.2). */
export const recordPrState = (
  state: WorkOrderState,
  command: CommandOf<'RecordPrState'>,
  ctx: DecideContext,
): Decision => {
  const denied = requireActor(ctx, ['factory']);
  if (denied) return err(denied);
  if (!state.delivery) return err(precondition('the Work order has no PR'));
  return ok([
    { type: 'pr_state_changed', prUrl: command.prUrl, state: command.state },
  ]);
};
