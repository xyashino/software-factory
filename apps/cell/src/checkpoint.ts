import { lstat, realpath, stat } from 'node:fs/promises';
import { join, relative, isAbsolute } from 'node:path';
import type { CommandResult } from '@repo/factory-core/contracts/cell';
import type { CommitSha } from '@repo/factory-core/ids';
import { branchFor, wipRefFor } from './names';
import type { RunGit } from './ports';

/** The Cell's scratch directory, excluded from every commit (PROTOCOL §8.1). */
export const CELL_DIR = '.cell';

/** Tries of the dry-run and lease push before the Cycle fails as `crashed` (PROTOCOL §8.2). */
export const PUSH_ATTEMPTS = 3;

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
  todoId: string;
  orderId: string;
  stationId: string;
  n: number;
  cycleId: string;
  epoch: number;
  outcome: Outcome;
  outputs: readonly OutputSpec[];
  /** Uploads the blobs the command names. Runs after validation, before the commit. */
  upload: () => Promise<void>;
  /** Sends the command for the commit, with or without `dryRun`. */
  send: (commit: CommitSha, dryRun: boolean) => Promise<SendOutcome>;
}

/** The trailers that make a Work order's progress recoverable from git alone (PROTOCOL §8.3). */
export const trailers = (fields: {
  orderId: string;
  stationId: string;
  cycleId: string;
  epoch: number;
  outcome: Outcome;
}): string[] => [
  `Factory-Order: ${fields.orderId}`,
  `Factory-Station: ${fields.stationId}`,
  `Factory-Cycle: ${fields.cycleId}`,
  `Factory-Epoch: ${fields.epoch}`,
  `Factory-Outcome: ${fields.outcome}`,
];

/** The commit message of a checkpoint: subject `wip(<stationId>): cycle <n>`, then the trailers. */
export const commitMessage = (input: {
  orderId: string;
  stationId: string;
  n: number;
  cycleId: string;
  epoch: number;
  outcome: Outcome;
}): { subject: string; body: string } => ({
  subject: `wip(${input.stationId}): cycle ${input.n}`,
  body: trailers(input).join('\n'),
});

const isInside = (root: string, path: string): boolean => {
  const rel = relative(root, path);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
};

/**
 * Checks the outputs a Cycle declared (PROTOCOL §8.2 step 1): each exists, is non-empty when it is a
 * file, and resolves inside the worktree once symlinks are followed. Outputs may sit in `.cell/`
 * (PROTOCOL §9); that directory is simply never committed. A required output that is
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

/** Stages every change and commits it, even when empty. `.cell/` never shows: the mirror excludes it. */
const commitAll = async (
  input: CheckpointInput,
): Promise<{ ok: true; commit: CommitSha } | { ok: false; detail: string }> => {
  const add = await input.git(input.worktree, ['add', '-A', '--', '.']);
  if (add.code !== 0) return { ok: false, detail: add.stderr.trim() };
  const message = commitMessage(input);
  const commit = await input.git(input.worktree, [
    'commit',
    '--quiet',
    '--allow-empty',
    '--no-verify',
    '-m',
    message.subject,
    '-m',
    message.body,
  ]);
  if (commit.code !== 0) return { ok: false, detail: commit.stderr.trim() };
  const head = await input.git(input.worktree, ['rev-parse', 'HEAD']);
  if (head.code !== 0) return { ok: false, detail: head.stderr.trim() };
  return { ok: true, commit: head.stdout.trim() as CommitSha };
};

/** Fetches the branch tip before a push, as the lease expectation (empty when the branch is absent). */
const fetchTip = async (
  input: CheckpointInput,
  branch: string,
): Promise<string> => {
  const fetched = await input.git(input.worktree, [
    'fetch',
    '--quiet',
    'origin',
    `refs/heads/${branch}`,
  ]);
  if (fetched.code !== 0) return '';
  const tip = await input.git(input.worktree, ['rev-parse', 'FETCH_HEAD']);
  return tip.code === 0 ? tip.stdout.trim() : '';
};

/** Drops the local checkpoint commit, keeping its changes staged: the tree stays as the Operator left it. */
const dropCommit = (input: CheckpointInput): Promise<unknown> =>
  input.git(input.worktree, ['reset', '--soft', 'HEAD~1']);

const pushBranch = async (
  input: CheckpointInput,
  branch: string,
  commit: CommitSha,
): Promise<{ ok: true } | { ok: false; detail: string }> => {
  const tip = await fetchTip(input, branch);
  const push = await input.git(input.worktree, [
    'push',
    '--quiet',
    `--force-with-lease=refs/heads/${branch}:${tip}`,
    'origin',
    `${commit}:refs/heads/${branch}`,
  ]);
  return push.code === 0
    ? { ok: true }
    : { ok: false, detail: push.stderr.trim() };
};

/**
 * The checkpoint of PROTOCOL §8.2, normative: validate, upload, commit with trailers, dry-run, fetch
 * and `--force-with-lease` push (up to PUSH_ATTEMPTS), then send for real. A stale epoch at the
 * dry run stops the Cycle before any push. Only the final send makes the commit count.
 */
export const checkpoint = async (
  input: CheckpointInput,
): Promise<CheckpointResult> => {
  // A block or a Handover ends a Cycle before its outputs are finished: they are checked when they
  // exist, but a missing one is not a refusal (PROTOCOL §3.3, the Handover carries the rest).
  const finished = input.outcome === 'passed' || input.outcome === 'failed';
  const outputs = finished
    ? input.outputs
    : input.outputs.map((output) => ({ ...output, required: false }));
  const issues = await validateOutputs(input.worktree, outputs);
  if (issues.length > 0)
    return { status: 'rejected', detail: issues.join('; ') };
  await input.upload();

  const committed = await commitAll(input);
  if (!committed.ok) return { status: 'failed', detail: committed.detail };
  const commit = committed.commit;
  const branch = branchFor(input.todoId);

  for (let attempt = 1; attempt <= PUSH_ATTEMPTS; attempt += 1) {
    const dry = await input.send(commit, true);
    if (!dry.ok) {
      if (dry.code === 'stale_epoch') return { status: 'fenced' };
      if (dry.code === 'precondition' || dry.code === 'invalid') {
        await dropCommit(input);
        return { status: 'rejected', detail: dry.message };
      }
      await dropCommit(input);
      return { status: 'failed', detail: dry.message };
    }
    const pushed = await pushBranch(input, branch, commit);
    if (pushed.ok) break;
    if (attempt === PUSH_ATTEMPTS) {
      return {
        status: 'failed',
        detail: `push of ${branch} rejected ${PUSH_ATTEMPTS} times: ${pushed.detail}`,
      };
    }
  }

  const real = await input.send(commit, false);
  if (!real.ok) {
    if (real.code === 'stale_epoch') return { status: 'fenced' };
    return { status: 'failed', detail: real.message };
  }
  return { status: 'sent', commit, result: real.result };
};

/**
 * Pushes the WIP of a failed Cycle to `factory-wip/<todoId>/<cycleId>`, best effort (PROTOCOL §8.3).
 * The local commit is undone afterwards so the branch stays where the Work order left it. Returns
 * the commit sha, or undefined when nothing could be saved.
 */
export const pushWip = async (input: {
  worktree: string;
  git: RunGit;
  todoId: string;
  orderId: string;
  stationId: string;
  n: number;
  cycleId: string;
  epoch: number;
}): Promise<CommitSha | undefined> => {
  const add = await input.git(input.worktree, ['add', '-A', '--', '.']);
  if (add.code !== 0) return undefined;
  const message = commitMessage({ ...input, outcome: 'failed' });
  const commit = await input.git(input.worktree, [
    'commit',
    '--quiet',
    '--allow-empty',
    '--no-verify',
    '-m',
    message.subject,
    '-m',
    message.body,
  ]);
  if (commit.code !== 0) return undefined;
  const head = await input.git(input.worktree, ['rev-parse', 'HEAD']);
  if (head.code !== 0) return undefined;
  const sha = head.stdout.trim() as CommitSha;
  const pushed = await input.git(input.worktree, [
    'push',
    '--quiet',
    'origin',
    `${sha}:refs/heads/${wipRefFor(input.todoId, input.cycleId)}`,
  ]);
  await input.git(input.worktree, ['reset', '--soft', 'HEAD~1']);
  return pushed.code === 0 ? sha : undefined;
};
