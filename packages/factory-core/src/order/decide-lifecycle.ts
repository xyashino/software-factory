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
  const denied = requireActor(ctx, ['supervisor', 'factory']);
  if (denied) return err(denied);
  if (state.phase.kind === 'delivered') {
    return err(precondition('a delivered Work order cannot be cancelled'));
  }
  if (state.phase.kind === 'cancelled') {
    return err(precondition('the Work order is already cancelled'));
  }
  const job = state.activeJob;
  const ending = job
    ? loseJob(state, job, 'cancelled', 'the Work order was cancelled')
    : [];
  const events: OrderEvent[] = [
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

/** The claim endpoint: the queue hands the Work order's next job to a Worker (CORE §5.2, §6). */
export const claimJob = (
  state: WorkOrderState,
  command: CommandOf<'ClaimJob'>,
  ctx: DecideContext,
): Decision => {
  const denied = requireActor(ctx, ['factory']);
  if (denied) return err(denied);
  const holder = holderOf(state);
  if (holder.kind !== 'queue') {
    return err(precondition(`the Work order is held by ${holder.kind}`));
  }
  const next = nextJob(state);
  if (next.kind !== 'job') {
    return err(precondition(`nextJob is ${next.kind}, not a job`));
  }
  const jobId = jobIdSchema.parse(ctx.ids.next());
  const epoch = state.epoch + 1;
  const { kind } = next.job;
  if (next.job.kind === 'deliver') {
    return ok([
      { type: 'job_claimed', jobId, kind, workerId: command.workerId, epoch },
    ]);
  }
  const cycleId = cycleIdSchema.parse(ctx.ids.next());
  return ok([
    {
      type: 'job_claimed',
      jobId,
      kind,
      workerId: command.workerId,
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
  const denied = requireActor(ctx, ['worker']);
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

/** The Worker leaves its job on purpose; the job is lost as `worker_left` (CORE §5.2). */
export const releaseJob = (
  state: WorkOrderState,
  ctx: DecideContext,
): Decision => {
  const denied = requireActor(ctx, ['worker']);
  if (denied) return err(denied);
  const fence = fenced(state, ctx);
  if (!fence.ok) return fence;
  return ok(
    loseJob(state, fence.value, 'worker_left', 'the worker left the job'),
  );
};

export const reportDelivery = (
  state: WorkOrderState,
  command: CommandOf<'ReportDelivery'>,
  ctx: DecideContext,
): Decision => {
  const denied = requireActor(ctx, ['worker']);
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
