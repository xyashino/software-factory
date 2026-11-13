import type { WorkerId } from '../ids';
import type { Priority } from '../order/state';
import type { Limits, QueueEntry, WorkerView } from './types';

const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

/** `true` sorts first. */
const trueFirst = (a: boolean, b: boolean): number =>
  a === b ? 0 : a ? -1 : 1;

const inCooldown = (
  entry: QueueEntry,
  workerId: WorkerId,
  now: number,
): boolean =>
  entry.avoidWorkers.some(
    (avoid) => avoid.workerId === workerId && avoid.until > now,
  );

/** CORE §8 claimable rule. */
const isClaimable = (
  entry: QueueEntry,
  worker: WorkerView,
  limits: Limits,
): boolean => {
  if (entry.holder !== 'queue' || entry.next !== 'job') return false;
  if (entry.deps !== 'satisfied') return false;
  if (!worker.projects.includes(entry.projectId)) return false;
  if (entry.runner !== undefined && !worker.runners.includes(entry.runner))
    return false;
  if (
    !entry.requiredCapabilities.every((tag) =>
      worker.capabilities.includes(tag),
    )
  )
    return false;
  if (inCooldown(entry, worker.workerId, limits.now)) return false;
  const limit: { max: number; running: number } | undefined =
    limits.perProjectRunning[entry.projectId];
  if (limit === undefined || limit.running >= limit.max) return false;
  return worker.freeSlots > 0;
};

/**
 * CORE §8 ordering for one Worker, first key wins: priority, resumed, progressed, same Worker as
 * the last one (warm worktree), createdAt, orderId. The orderId tie-break makes it total.
 */
const compareEntries =
  (worker: WorkerView) =>
  (a: QueueEntry, b: QueueEntry): number => {
    const priority = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (priority !== 0) return priority;
    const resumed = trueFirst(a.resumed, b.resumed);
    if (resumed !== 0) return resumed;
    const progressed = trueFirst(a.progressed, b.progressed);
    if (progressed !== 0) return progressed;
    const warm = trueFirst(
      a.lastWorkerId === worker.workerId,
      b.lastWorkerId === worker.workerId,
    );
    if (warm !== 0) return warm;
    const createdAt = a.createdAt - b.createdAt;
    if (createdAt !== 0) return createdAt;
    if (a.orderId === b.orderId) return 0;
    return a.orderId < b.orderId ? -1 : 1;
  };

/**
 * Work orders this Worker may claim, best first. Pure: the input is not mutated. Callers take the
 * first entry. Dependencies are read from `entry.deps`, computed when the queue was read.
 */
export const selectClaimable = (
  queue: readonly QueueEntry[],
  worker: WorkerView,
  limits: Limits,
): QueueEntry[] =>
  queue
    .filter((entry) => isClaimable(entry, worker, limits))
    .sort(compareEntries(worker));
