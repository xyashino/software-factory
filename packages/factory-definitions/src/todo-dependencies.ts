import type { OrderId } from '@repo/factory-core/ids';
import type { TodoFileState } from './todo-scan';

/** What the dependency rule reads: the todo files and the Work orders already delivered. */
export interface DependencyView {
  /** state of each todo file, keyed by OrderId; absent means no file */
  fileStates: ReadonlyMap<OrderId, TodoFileState>;
  /** OrderIds whose Work order is delivered */
  delivered: ReadonlySet<OrderId>;
}

export type DependencyState = 'satisfied' | 'waiting';

/**
 * The missing-dependency rule (ADR clarify-missing-dependency-rule):
 * - no todo file for it: satisfied (delivered todos are removed from todos/);
 * - file marked `done`: satisfied;
 * - its Work order is delivered: satisfied;
 * - anything else, including `todo`, `cancelled` and an unparseable file: waiting.
 * An unparseable dependency never counts as satisfied.
 */
export const dependencyState = (
  dep: OrderId,
  view: DependencyView,
): DependencyState => {
  const state = view.fileStates.get(dep);
  if (state === undefined || state === 'done') {
    return 'satisfied';
  }
  if (state === 'unparseable') {
    return 'waiting';
  }
  return view.delivered.has(dep) ? 'satisfied' : 'waiting';
};

/** The dependencies that still block, in the order they were declared. */
export const waitingOn = (
  dependsOn: readonly OrderId[],
  view: DependencyView,
): OrderId[] =>
  dependsOn.filter((dep) => dependencyState(dep, view) === 'waiting');
