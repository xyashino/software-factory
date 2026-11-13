/** The worktree state a delivery requires, read after the delivery commit. */
export interface DeliveryState {
  /** paths still dirty after the commit */
  uncommitted: string[];
  /** paths added on the task branch relative to the base */
  added: string[];
}

/**
 * Errors that block delivery. A new PR needs exactly one new `decisions/` entry
 * (AGENTS.md: every completed change has one ADR).
 */
export const validateDeliveryState = (state: DeliveryState): string[] => {
  const errors: string[] = [];
  if (state.uncommitted.length > 0) {
    errors.push(
      `worktree still has uncommitted files: ${state.uncommitted.join(', ')}`,
    );
  }
  const decisions = adrPaths(state.added);
  if (decisions.length !== 1) {
    errors.push(
      `expected exactly one new decisions/ entry, found ${decisions.length}`,
    );
  }
  return errors;
};

/** The new decision records the branch added. */
export const adrPaths = (added: string[]): string[] => {
  return added.filter((path) => /^decisions\/.+\.md$/.test(path));
};
