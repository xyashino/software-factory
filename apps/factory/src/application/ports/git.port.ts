export interface GitPort {
  currentBranch(cwd: string): Promise<string>;
  isClean(cwd: string): Promise<boolean>;
  worktreeAdd(
    repoRoot: string,
    path: string,
    branch: string,
    baseBranch: string,
  ): Promise<void>;
  worktreeRemove(repoRoot: string, path: string): Promise<void>;
  excludeLocally(worktree: string, pattern: string): Promise<void>;
  commit(cwd: string, paths: readonly string[], message: string): Promise<void>;
  push(cwd: string, branch: string): Promise<void>;
  headSha(cwd: string): Promise<string>;
  status(cwd: string): Promise<string>;
}
