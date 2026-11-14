export interface GitPort {
  createWorktree(input: {
    path: string;
    branch: string;
    base: string;
  }): Promise<void>;
  removeWorktree(path: string): Promise<void>;
  /** Returns the snapshot commit sha. */
  snapshot(input: { worktree: string; ref: string }): Promise<string>;
  restore(input: { worktree: string; ref: string }): Promise<void>;
  /** Whether the worktree (tracked and untracked, not ignored) differs from the snapshot. */
  differsFromSnapshot(input: {
    worktree: string;
    ref: string;
  }): Promise<boolean>;
  hasChanges(input: { worktree: string; base: string }): Promise<boolean>;
  /** Returns the new commit sha. */
  commitAll(input: { worktree: string; message: string }): Promise<string>;
  push(input: { worktree: string; branch: string }): Promise<void>;
  remoteBranchExists(branch: string): Promise<boolean>;
  /** Paths with uncommitted changes (tracked or untracked), relative to the worktree. */
  uncommittedFiles(worktree: string): Promise<string[]>;
  /** Removes a file (relative to the worktree) and stages the deletion. No-op when it is absent. */
  removeFile(input: { worktree: string; path: string }): Promise<void>;
  /** Paths added on the worktree branch relative to `base`. */
  addedFiles(input: { worktree: string; base: string }): Promise<string[]>;
  headSha(worktree: string): Promise<string>;
  /** Removes every snapshot ref of a task under `refs/software-factory/<taskId>/`. */
  deleteSnapshotRefs(taskId: string): Promise<void>;
}
