import type { CommitSha, ProjectId } from '../ids';

/** One file under `todos/` at a commit, as text. Paths are relative to the repository root. */
export interface TodoFile {
  file: string;
  text: string;
}

/** What intake needs to know about a project's repository (PROTOCOL §3.0, STORAGE §4). */
export interface MirroredProject {
  projectId: ProjectId;
  repoUrl: string;
  baseBranch: string;
}

/** One commit of a branch: its sha and its full message (subject, blank line, trailers). */
export interface BranchCommit {
  sha: CommitSha;
  message: string;
}

/** A branch of the mirror and its commits, newest first from the tip (STORAGE §8). */
export interface BranchLog {
  branch: string;
  commits: BranchCommit[];
}

/**
 * The project's bare mirror (ROADMAP M4). The real adapter runs `git` behind this port; tests use a
 * fixture repository or a fake. Reads never write to the working tree.
 */
export interface GitMirror {
  /** Creates or fetches the mirror and returns the commit at the tip of the base branch. */
  sync(project: MirroredProject): Promise<CommitSha>;
  /** Every `todos/*.md` file at a commit. */
  todoFiles(projectId: ProjectId, commit: CommitSha): Promise<TodoFile[]>;
  /** Every branch whose name starts with `prefix`, with its commits from the tip (STORAGE §8). */
  branches(projectId: ProjectId, prefix: string): Promise<BranchLog[]>;
}
