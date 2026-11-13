import type { GitPort } from '../ports/git.port';

export interface GitCall {
  method: keyof GitPort;
  args: unknown[];
}

/** In-memory git: snapshots are remembered by ref, and `restore` only succeeds for known refs. */
export class FakeGit implements GitPort {
  readonly calls: GitCall[] = [];
  changes = false;
  readonly branches = new Set<string>();
  private readonly snapshots = new Map<string, string>();
  private counter = 0;

  async createWorktree(input: { path: string; branch: string; base: string }) {
    this.record('createWorktree', input);
    this.branches.add(input.branch);
  }

  async removeWorktree(path: string) {
    this.record('removeWorktree', path);
  }

  async snapshot(input: { worktree: string; ref: string }): Promise<string> {
    this.record('snapshot', input);
    this.counter += 1;
    const sha = `sha${this.counter}`;
    this.snapshots.set(input.ref, sha);
    return sha;
  }

  async restore(input: { worktree: string; ref: string }) {
    this.record('restore', input);
    if (!this.snapshots.has(input.ref)) {
      throw new Error(`unknown snapshot "${input.ref}"`);
    }
  }

  /** set by a test to simulate an agent editing the worktree */
  differs = false;

  async differsFromSnapshot(input: {
    worktree: string;
    ref: string;
  }): Promise<boolean> {
    this.record('differsFromSnapshot', input);
    return this.differs;
  }

  async hasChanges(input: {
    worktree: string;
    base: string;
  }): Promise<boolean> {
    this.record('hasChanges', input);
    return this.changes;
  }

  async commitAll(input: {
    worktree: string;
    message: string;
  }): Promise<string> {
    this.record('commitAll', input);
    this.counter += 1;
    this.uncommitted = [];
    return `sha${this.counter}`;
  }

  async push(input: { worktree: string; branch: string }) {
    this.record('push', input);
    this.branches.add(input.branch);
  }

  async remoteBranchExists(branch: string): Promise<boolean> {
    this.record('remoteBranchExists', branch);
    return this.branches.has(branch);
  }

  uncommitted: string[] = [];
  added: string[] = [];
  readonly deletedTasks: string[] = [];

  async uncommittedFiles(worktree: string): Promise<string[]> {
    this.record('uncommittedFiles', worktree);
    return this.uncommitted;
  }

  async removeFile(input: { worktree: string; path: string }): Promise<void> {
    this.record('removeFile', input);
    if (!this.uncommitted.includes(input.path)) {
      this.uncommitted = [...this.uncommitted, input.path];
    }
  }

  async addedFiles(input: {
    worktree: string;
    base: string;
  }): Promise<string[]> {
    this.record('addedFiles', input);
    return this.added;
  }

  async headSha(worktree: string): Promise<string> {
    this.record('headSha', worktree);
    return `sha${this.counter}`;
  }

  async deleteSnapshotRefs(taskId: string): Promise<void> {
    this.record('deleteSnapshotRefs', taskId);
    this.deletedTasks.push(taskId);
  }

  private record(method: keyof GitPort, ...args: unknown[]): void {
    this.calls.push({ method, args });
  }
}
