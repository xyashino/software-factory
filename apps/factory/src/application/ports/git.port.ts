export interface GitPort {
  currentBranch(cwd: string): Promise<string>;
  isClean(cwd: string): Promise<boolean>;
}
