import type { CellId } from '../ids';
import type { Priority } from '../order/state';
import type { Limits, QueueEntry, CellView } from './types';

const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

/** `true` sorts first. */
const trueFirst = (a: boolean, b: boolean): number =>
  a === b ? 0 : a ? -1 : 1;

const inCooldown = (entry: QueueEntry, cellId: CellId, now: number): boolean =>
  entry.avoidCells.some(
    (avoid) => avoid.cellId === cellId && avoid.until > now,
  );

/** CORE §8 claimable rule. */
const isClaimable = (
  entry: QueueEntry,
  cell: CellView,
  limits: Limits,
): boolean => {
  if (entry.holder !== 'queue' || entry.next !== 'job') return false;
  if (entry.deps !== 'satisfied') return false;
  if (!cell.projects.includes(entry.projectId)) return false;
  if (entry.runner !== undefined && !cell.runners.includes(entry.runner))
    return false;
  if (
    !entry.requiredCapabilities.every((tag) => cell.capabilities.includes(tag))
  )
    return false;
  if (inCooldown(entry, cell.cellId, limits.now)) return false;
  const limit: { max: number; running: number } | undefined =
    limits.perProjectRunning[entry.projectId];
  if (limit === undefined || limit.running >= limit.max) return false;
  return cell.freeSlots > 0;
};

/**
 * CORE §8 ordering for one Cell, first key wins: priority, resumed, progressed, same Cell as
 * the last one (warm worktree), createdAt, orderId. The orderId tie-break makes it total.
 */
const compareEntries =
  (cell: CellView) =>
  (a: QueueEntry, b: QueueEntry): number => {
    const priority = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (priority !== 0) return priority;
    const resumed = trueFirst(a.resumed, b.resumed);
    if (resumed !== 0) return resumed;
    const progressed = trueFirst(a.progressed, b.progressed);
    if (progressed !== 0) return progressed;
    const warm = trueFirst(
      a.lastCellId === cell.cellId,
      b.lastCellId === cell.cellId,
    );
    if (warm !== 0) return warm;
    const createdAt = a.createdAt - b.createdAt;
    if (createdAt !== 0) return createdAt;
    if (a.orderId === b.orderId) return 0;
    return a.orderId < b.orderId ? -1 : 1;
  };

/**
 * Work orders this Cell may claim, best first. Pure: the input is not mutated. Callers take the
 * first entry. Dependencies are read from `entry.deps`, computed when the queue was read.
 */
export const selectClaimable = (
  queue: readonly QueueEntry[],
  cell: CellView,
  limits: Limits,
): QueueEntry[] =>
  queue
    .filter((entry) => isClaimable(entry, cell, limits))
    .sort(compareEntries(cell));
