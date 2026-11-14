import type { Job } from '@repo/factory-core/contracts/job';
import { MAX_CLAIM_WAIT_MS } from '@repo/factory-core/contracts/cell';
import type { CellId } from '@repo/factory-core/ids';
import { selectClaimable } from '@repo/factory-core/queue/select';
import { assertCell } from './cells';
import type { CommandHandler } from './command-handler';
import type { Notifier } from './notifier';
import { readQueue, cellView } from './queue';
import type { RuntimePorts } from './ports';

export interface ClaimDeps {
  ports: RuntimePorts;
  handler: CommandHandler;
  notifier: Notifier;
}

/**
 * Offers the Cell the best job it can run, if any (PROTOCOL §5.2). Candidates come from the queue,
 * best first; each one is claimed through the command loop as `ClaimJob`. A candidate refused by a
 * conflict or a rule is skipped, so the next one is tried.
 */
export const claimOnce = async (
  deps: ClaimDeps,
  cellId: CellId,
): Promise<Job | null> => {
  const { ports, handler } = deps;
  const cell = await assertCell(ports, cellId);
  const held = (await ports.leases.forCell(cellId)).length;
  const view = cellView(cellId, cell.info, held);
  if (view.freeSlots <= 0) return null;
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
