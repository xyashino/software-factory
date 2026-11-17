import { lstat, realpath, stat } from 'node:fs/promises';
import { join, relative, isAbsolute } from 'node:path';
import type { CommandResult } from '@repo/factory-core/contracts/cell';
import type { CommitSha } from '@repo/factory-core/ids';
import type { RunGit } from './ports';

/** The Cell's scratch directory, git-excluded from every worktree. */
export const CELL_DIR = '.cell';

export type Outcome = 'passed' | 'failed' | 'blocked' | 'handed_over';

export interface OutputSpec {
  key: string;
  path: string;
  required: boolean;
}

/** The reply of a command the Cell sent: its result, or the wire error code it was refused with. */
export type SendOutcome =
  | { ok: true; result: CommandResult }
  | { ok: false; code: string; message: string };

export type CheckpointResult =
  | { status: 'sent'; commit: CommitSha; result: CommandResult }
  | { status: 'rejected'; detail: string }
  | { status: 'fenced' }
  | { status: 'failed'; detail: string };

export interface CheckpointInput {
  worktree: string;
  git: RunGit;
  outcome: Outcome;
  outputs: readonly OutputSpec[];
  /** Uploads the blobs the command names. Runs after validation, before the command is sent. */
  upload: () => Promise<void>;
  /** Sends the command for the commit, with or without `dryRun`. */
  send: (commit: CommitSha, dryRun: boolean) => Promise<SendOutcome>;
}

const isInside = (root: string, path: string): boolean => {
  const rel = relative(root, path);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
};

/**
 * Checks the outputs a Cycle declared: each exists, is non-empty when it is a
 * file, and resolves inside the worktree once symlinks are followed. Outputs may sit in `.cell/`;
 * that directory is simply never part of a commit. A required output that is
 * missing is an issue; an optional one may be absent. Returns the issues, empty when all is well.
 */
export const validateOutputs = async (
  worktree: string,
  outputs: readonly OutputSpec[],
): Promise<string[]> => {
  const root = await realpath(worktree);
  const issues: string[] = [];
  for (const output of outputs) {
    const path = join(worktree, output.path);
    let info;
    try {
      info = await lstat(path);
    } catch {
      if (output.required) issues.push(`output "${output.key}" is missing`);
      continue;
    }
    const resolved = await realpath(path).catch(() => undefined);
    if (resolved === undefined || !isInside(root, resolved)) {
      issues.push(`output "${output.key}" resolves outside the worktree`);
      continue;
    }
    if (info.isFile() && (await stat(resolved)).size === 0) {
      issues.push(`output "${output.key}" is empty`);
    }
  }
  return issues;
};

/**
 * The checkpoint of a Cycle: validate, upload,
 * read the worktree's HEAD, dry-run the command, then send it for real. No commit is made and nothing is
 * pushed: the uncommitted work stays in the worktree for the next Station, and `deliver` publishes it.
 * A stale epoch at the dry run stops the Cycle before the real command. The commit a
 * command names is the worktree's HEAD, the commit the Cycle started from.
 */
export const checkpoint = async (
  input: CheckpointInput,
): Promise<CheckpointResult> => {
  // A block or a Handover ends a Cycle before its outputs are finished: they are checked when they
  // exist, but a missing one is not a refusal (the Handover carries the rest).
  const finished = input.outcome === 'passed' || input.outcome === 'failed';
  const outputs = finished
    ? input.outputs
    : input.outputs.map((output) => ({ ...output, required: false }));
  const issues = await validateOutputs(input.worktree, outputs);
  if (issues.length > 0)
    return { status: 'rejected', detail: issues.join('; ') };
  await input.upload();

  const head = await input.git(input.worktree, ['rev-parse', 'HEAD']);
  if (head.code !== 0) return { status: 'failed', detail: head.stderr.trim() };
  const commit = head.stdout.trim() as CommitSha;

  const dry = await input.send(commit, true);
  if (!dry.ok) {
    if (dry.code === 'stale_epoch') return { status: 'fenced' };
    if (dry.code === 'precondition' || dry.code === 'invalid') {
      return { status: 'rejected', detail: dry.message };
    }
    return { status: 'failed', detail: dry.message };
  }

  const real = await input.send(commit, false);
  if (!real.ok) {
    if (real.code === 'stale_epoch') return { status: 'fenced' };
    return { status: 'failed', detail: real.message };
  }
  return { status: 'sent', commit, result: real.result };
};
