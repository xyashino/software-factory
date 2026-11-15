import type { Job } from '@repo/factory-core/contracts/job';
import { MAX_CLAIM_WAIT_MS } from '@repo/factory-core/contracts/cell';
import type { CellId, PlanId } from '@repo/factory-core/ids';
import type { PlanProjection } from '@repo/factory-core/plan/projection';
import type { CellView } from '@repo/factory-core/queue/types';
import { selectClaimable } from '@repo/factory-core/queue/select';
import { assertCell } from './cells';
import type { CommandHandler } from './command-handler';
import { isRuntimeError } from './errors';
import { buildPlanJob } from './job-builder';
import type { Notifier } from './notifier';
import { readQueue, cellView } from './queue';
import type { RuntimePorts } from './ports';

export interface ClaimDeps {
  ports: RuntimePorts;
  handler: CommandHandler;
  notifier: Notifier;
  /** The lazy reaper: expired leases return to the queue before a claim is offered (PROTOCOL §5.4). */
  reap: () => Promise<number>;
}

/**
 * The plans this Cell may take a job of (PROTOCOL §4): a plan whose next step is a job, in a project the
 * Cell serves, not in cooldown here. The Cell that ran the plan's last job comes first (a warm mirror).
 */
const claimablePlans = (
  plans: readonly PlanProjection[],
  view: CellView,
  now: number,
): PlanProjection[] =>
  plans
    .filter(
      (plan) =>
        plan.nextKind === 'job' &&
        plan.holder === 'queue' &&
        plan.jobKind !== null &&
        view.projects.includes(plan.projectId) &&
        !plan.avoidCells.some(
          (avoid) => avoid.cellId === view.cellId && avoid.until > now,
        ),
    )
    .sort((a, b) => {
      const warm =
        Number(b.lastCellId === view.cellId) -
        Number(a.lastCellId === view.cellId);
      if (warm !== 0) return warm;
      if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
      return a.planId < b.planId ? -1 : a.planId > b.planId ? 1 : 0;
    });

/**
 * Claims one plan job for the Cell (PROTOCOL §4). The `ClaimJob` and the job's lease are written in one
 * transaction, so a claimed plan job always has a lease the reaper can expire. A refused candidate is
 * skipped, as a Work order's is.
 */
const claimPlanOnce = async (
  deps: ClaimDeps,
  cellId: CellId,
  view: CellView,
): Promise<Job | null> => {
  const { ports, handler } = deps;
  const now = ports.clock.now();
  for (const plan of claimablePlans(
    await ports.projections.plans(),
    view,
    now,
  )) {
    const planId = plan.planId as PlanId;
    try {
      const result = await handler.submitPlan({
        planId,
        commandId: ports.ids.commandId(),
        command: { type: 'ClaimJob', cellId },
        actor: { kind: 'factory' },
        lease: (events) => {
          const claimed = events.find((event) => event.type === 'job_claimed');
          if (claimed?.type !== 'job_claimed') return undefined;
          return {
            orderId: planId,
            jobId: claimed.jobId,
            cellId,
            epoch: claimed.epoch,
            expiresAt: ports.clock.now() + ports.config.leaseTtlMs,
          };
        },
      });
      const claimed = result.events.find(
        (event) => event.type === 'job_claimed',
      );
      if (claimed?.type !== 'job_claimed') continue;
      const after = (await ports.projections.plans()).find(
        (row) => row.planId === planId,
      );
      const project = (await ports.projects.list()).find(
        (candidate) => candidate.projectId === plan.projectId,
      );
      if (!after || !project) continue;
      return await buildPlanJob(ports.blobs, {
        jobId: claimed.jobId,
        epoch: claimed.epoch,
        kind: claimed.kind,
        plan: after,
        project,
        rows: await ports.projections.orders(),
      });
    } catch (error) {
      if (!isRuntimeError(error)) throw error;
    }
  }
  return null;
};

/**
 * Offers the Cell the best job it can run, if any (PROTOCOL §5.2). Plan jobs come first: they are short
 * and unblock their plan's members. Then the queue, best first. Each candidate is claimed through the
 * command loop as `ClaimJob`. A candidate refused by a conflict or a rule is skipped, so the next one is
 * tried.
 */
export const claimOnce = async (
  deps: ClaimDeps,
  cellId: CellId,
): Promise<Job | null> => {
  const { ports, handler } = deps;
  const cell = await assertCell(ports, cellId);
  await deps.reap();
  const held = (await ports.leases.forCell(cellId)).length;
  const view = cellView(cellId, cell.info, held);
  if (view.busy) return null;
  const planJob = await claimPlanOnce(deps, cellId, view);
  if (planJob) return planJob;
  const queue = await readQueue(ports);
  for (const candidate of selectClaimable(queue.entries, view, queue.limits)) {
    const result = await handler.submit({
      orderId: candidate.orderId,
      commandId: ports.ids.commandId(),
      command: { type: 'ClaimJob', cellId },
      actor: { kind: 'factory' },
      onRefusal: 'skip',
    });
    if (result?.next) return result.next;
  }
  return null;
};

/**
 * The long-poll of `claim` (PROTOCOL §5.2): answers at once when a job is on offer, otherwise waits
 * until a commit wakes it, the tick passes, or the wait or the request ends. Never longer than
 * `min(waitMs, 25 s)`, measured on the Factory clock.
 */
export const longPollClaim = async (
  deps: ClaimDeps,
  cellId: CellId,
  waitMs: number,
  signal?: AbortSignal,
): Promise<Job | null> => {
  const { ports } = deps;
  const deadline = ports.clock.now() + Math.min(waitMs, MAX_CLAIM_WAIT_MS);
  for (;;) {
    const job = await claimOnce(deps, cellId);
    if (job) return job;
    if (signal?.aborted) return null;
    const remaining = deadline - ports.clock.now();
    if (remaining <= 0) return null;
    await deps.notifier.waitFor(
      Math.min(remaining, ports.config.claimTickMs),
      signal,
    );
    if (signal?.aborted) return null;
  }
};
