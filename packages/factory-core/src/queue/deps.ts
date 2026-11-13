import type { OrderId } from '../ids';
import type { Next } from '../order/next';
import type { OrderProjection } from '../order/projection';
import type { BoardStatus } from '../order/status';

/** STORAGE §4 `dep_policy`: a dependency is satisfied when delivered (PR opened) or when merged. */
export type DepPolicy = 'delivered' | 'merged';

export type DepState = 'satisfied' | 'waiting' | 'broken';

/** The fields of another Work order a dependency outcome reads. */
export type DepRow = Pick<OrderProjection, 'orderId' | 'status' | 'prState'>;

/** Board status with the dependency overlay (STORAGE §4). Base statuses never carry these. */
export type OverlayStatus = BoardStatus | 'waiting_deps' | 'deps_broken';

const outcomeOf = (row: DepRow, depPolicy: DepPolicy): DepState => {
  if (row.status === 'cancelled') return 'broken';
  if (row.status === 'merged') return 'satisfied';
  if (row.status === 'delivered') {
    if (depPolicy === 'delivered') return 'satisfied';
    return row.prState === 'closed' ? 'broken' : 'waiting';
  }
  return 'waiting';
};

/**
 * CORE §8 dependency outcome of one Work order. A dependency that names no row in `others` is
 * satisfied (v1 parity). Any broken dependency makes the whole entry broken; else any waiting one
 * makes it waiting. The CORE §8 rule that a reopened dependency does not stop a started dependent
 * is not special-cased here: the outcome reads the rows as given, so the caller decides which rows
 * to pass.
 */
export const resolveDeps = (
  entry: { dependsOn: readonly OrderId[] },
  others: readonly DepRow[],
  depPolicy: DepPolicy,
): DepState => {
  const byId = new Map(others.map((row) => [row.orderId, row]));
  const outcomes = entry.dependsOn.map((orderId) => {
    const row = byId.get(orderId);
    return row ? outcomeOf(row, depPolicy) : 'satisfied';
  });
  if (outcomes.includes('broken')) return 'broken';
  if (outcomes.includes('waiting')) return 'waiting';
  return 'satisfied';
};

/**
 * Board status with the dependency overlay (STORAGE §4): only a queued Work order whose next step
 * is a job can wait or break on its dependencies. Anything else keeps its base status.
 */
export const boardStatusWithDeps = (
  status: BoardStatus,
  nextKind: Next['kind'],
  deps: DepState,
): OverlayStatus => {
  if (status !== 'queued' || nextKind !== 'job') return status;
  if (deps === 'waiting') return 'waiting_deps';
  if (deps === 'broken') return 'deps_broken';
  return status;
};
