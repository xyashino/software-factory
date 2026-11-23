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
  deleteBranch(repoRoot: string, branch: string): Promise<void>;
  excludeLocally(worktree: string, pattern: string): Promise<void>;
  commit(cwd: string, paths: readonly string[], message: string): Promise<void>;
  push(cwd: string, branch: string): Promise<void>;
  headSha(cwd: string): Promise<string>;
  status(cwd: string): Promise<string>;
  clone(url: string, dest: string): Promise<void>;
  originUrl(cwd: string): Promise<string | null>;
  resetHard(cwd: string, sha: string): Promise<void>;
  clean(cwd: string): Promise<void>;
  discardChanges(cwd: string): Promise<void>;
  hasCommit(cwd: string, sha: string): Promise<boolean>;
}
