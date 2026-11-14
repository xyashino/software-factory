/** The state a pull request can be in, as the runtime records it (`RecordPrState`, CORE §5.2). */
export type PrState = 'open' | 'merged' | 'closed';

/** A pull request found by its head branch: its URL and state. */
export interface PrForBranch {
  prUrl: string;
  state: PrState;
}

/** Reads the current state of a delivered Work order's pull request (PROTOCOL §8). */
export interface PrStatePort {
  read(prUrl: string): Promise<PrState>;
  /**
   * The pull request whose head is `branch` in the project's repository, or undefined when there is
   * none. An open one wins over closed or merged ones (STORAGE §8, recovery).
   */
  forBranch(repoUrl: string, branch: string): Promise<PrForBranch | undefined>;
}
