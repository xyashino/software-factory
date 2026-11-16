import { join } from 'node:path';
import { WireFailure } from '@repo/factory-core/contracts/errors';
import type { Job } from '@repo/factory-core/contracts/job';
import type { CommitSha } from '@repo/factory-core/ids';
import type { BlockedPrResult } from '@repo/factory-core/order/events';
import { GIT_TIMEOUT_MS } from '../workspace/repo';
import { prepareWorkspace } from '../workspace/prepare';
import {
  gitCommand,
  runShell,
  succeeded,
  textOf,
  type ShellContext,
  type ShellRun,
} from '../workspace/shell';
import { redactDetail } from './redact';
import { renderBlockedPr } from './render';
import { JobStopped, submit, type JobContext } from './send';

const MAX_DETAIL_CHARS = 500;
const COMMIT = /^[0-9a-f]{40}$/;

/** The identity of the WIP commit a blocked publish writes (the delivery squashes it later). */
const IDENTITY = [
  '-c',
  'user.name=Software Factory',
  '-c',
  'user.email=software-factory@localhost',
];

/** The last characters of a run's output, for a failure detail, with machine-local values redacted. */
const tailOfRun = (run: ShellRun): string =>
  redactDetail(textOf(run).trim(), MAX_DETAIL_CHARS, 'end');

const errorText = (error: unknown): string =>
  redactDetail(
    error instanceof Error ? error.message : String(error),
    MAX_DETAIL_CHARS,
  );

/** A publish that cannot finish here: reported as failed, and nothing more is pushed. */
class PublishFailed extends Error {}

/** Runs one git command in the worktree. */
const git = (
  shell: ShellContext,
  cwd: string,
  args: readonly string[],
): Promise<ShellRun> =>
  runShell(shell, {
    command: gitCommand(args),
    cwd,
    timeoutMs: GIT_TIMEOUT_MS,
  });

/** Sends `ReportBlockedPr` for the job. The Andon it names is left as it is. */
const report = (
  ctx: JobContext,
  job: Job,
  result: BlockedPrResult,
  signal: AbortSignal,
): Promise<unknown> =>
  submit(ctx, job, { type: 'ReportBlockedPr', result }, signal);

/**
 * Runs one `publish_blocked` job (v1 `publishBlockedWork`, PROTOCOL §8.3). A supervisor-held Andon gets its
 * work on GitHub for human inspection: the worktree's changes against `origin/<baseBranch>` go to a draft
 * `[BLOCKED]` PR. It is best-effort and never changes the Andon:
 *
 * 1. prepare the workspace in `reuse` mode. A missing worktree is a failed publish, not a reset: the Work
 *    order stays where it is.
 * 2. stage every change. Nothing against the base is `no_changes`: no commit, no push, no PR.
 * 3. render the `[BLOCKED]` title and body from the repo's `.factory/templates/pr/blocked.md`.
 * 4. commit the staged work as a WIP commit when it is not committed yet, dry-run the push with the lease,
 *    then push `factory/<todoId>` with `--force-with-lease` on the tip origin holds.
 * 5. update the open PR for the branch (body and title), or create a draft PR, then `ReportBlockedPr`.
 *
 * Any other failure is reported as `failed` with its detail. The job never throws for one, and never sends
 * a delivery report. A stopped signal or a refusal sends nothing more.
 */
export const runPublishBlocked = async (
  ctx: JobContext,
  job: Job,
  signal: AbortSignal,
): Promise<void> => {
  const blocked = job.blocked;
  if (!blocked)
    throw new Error(`publish_blocked job ${job.jobId} has no blocked block`);
  if (signal.aborted) return;

  const shell: ShellContext = {
    system: ctx.system,
    logDir: join(ctx.cellDataDir, 'logs', job.jobId),
    signal,
  };

  try {
    const prepared = await prepareWorkspace(
      {
        shell,
        repoRoot: ctx.repoRoot,
        worktreeLimit: ctx.worktreeLimit,
        inUse: ctx.inUse,
      },
      job,
    );
    if (!prepared.ok) {
      await report(
        ctx,
        job,
        {
          status: 'failed',
          detail: redactDetail(
            `workspace ${prepared.stage}: ${prepared.detail}`,
            MAX_DETAIL_CHARS,
          ),
        },
        signal,
      );
      return;
    }
    try {
      await publishWorktree(
        ctx,
        job,
        blocked,
        shell,
        prepared.worktree,
        signal,
      );
    } finally {
      prepared.release();
    }
  } catch (error) {
    if (error instanceof WireFailure || error instanceof JobStopped)
      throw error;
    if (signal.aborted) throw error;
    await report(
      ctx,
      job,
      {
        status: 'failed',
        detail: errorText(error),
      },
      signal,
    );
  }
};

const publishWorktree = async (
  ctx: JobContext,
  job: Job,
  blocked: NonNullable<Job['blocked']>,
  shell: ShellContext,
  worktree: string,
  signal: AbortSignal,
): Promise<void> => {
  const branch = job.repo.branch;
  const baseRef = `refs/remotes/origin/${job.repo.baseBranch}`;
  const remoteRef = `refs/remotes/origin/${branch}`;
  const branchRef = `refs/heads/${branch}`;

  const baseRun = await git(shell, worktree, [
    'rev-parse',
    '--verify',
    '--quiet',
    `${baseRef}^{commit}`,
  ]);
  if (!succeeded(baseRun)) {
    throw new PublishFailed(
      `branch ${job.repo.baseBranch} is missing on origin`,
    );
  }

  const tipRun = await git(shell, worktree, [
    'rev-parse',
    '--verify',
    '--quiet',
    `${remoteRef}^{commit}`,
  ]);
  const remoteTip = succeeded(tipRun) ? textOf(tipRun).trim() : '';

  const staged = await git(shell, worktree, ['add', '-A', '--', '.']);
  if (!succeeded(staged)) {
    throw new PublishFailed(`staging failed: ${tailOfRun(staged)}`);
  }

  // The changes against the base: what the index holds that the base does not. Empty means nothing to inspect.
  const changed = await git(shell, worktree, [
    'diff',
    '--cached',
    '--name-only',
    baseRef,
    '--',
  ]);
  if (!succeeded(changed)) {
    throw new PublishFailed(`diff failed: ${tailOfRun(changed)}`);
  }
  if (textOf(changed).trim() === '') {
    await report(ctx, job, { status: 'no_changes' }, signal);
    return;
  }

  // Rendered before anything is written, so a repo whose templates cannot render the PR pushes nothing.
  const rendered = await renderBlockedPr({ blocked, worktree });

  const pending = await git(shell, worktree, [
    'diff',
    '--cached',
    '--quiet',
    'HEAD',
    '--',
  ]);
  if (!succeeded(pending)) {
    const wip = await git(shell, worktree, [
      ...IDENTITY,
      'commit',
      '--quiet',
      '--no-verify',
      '-m',
      `chore(factory): WIP of blocked ${blocked.taskId}`,
    ]);
    if (!succeeded(wip)) {
      throw new PublishFailed(`WIP commit failed: ${tailOfRun(wip)}`);
    }
  }
  const headRun = await git(shell, worktree, ['rev-parse', 'HEAD']);
  const commit = textOf(headRun).trim();
  if (!succeeded(headRun) || !COMMIT.test(commit)) {
    throw new PublishFailed('the blocked commit has no sha');
  }

  const lease = `${branchRef}:${remoteTip}`;
  const dryPush = await git(shell, worktree, [
    'push',
    '--dry-run',
    `--force-with-lease=${lease}`,
    job.repo.url,
    `HEAD:${branchRef}`,
  ]);
  if (!succeeded(dryPush)) {
    throw new PublishFailed(`push refused: ${tailOfRun(dryPush)}`);
  }

  // A dry run of the report: a stale epoch stops the job before the real push (as a delivery does).
  try {
    await submit(
      ctx,
      job,
      {
        type: 'ReportBlockedPr',
        result: { status: 'failed', detail: 'dry run before the push' },
      },
      signal,
      { dryRun: true },
    );
  } catch (error) {
    if (error instanceof WireFailure && error.error.code === 'stale_epoch') {
      throw new JobStopped(
        'stale epoch on the blocked publish dry run; nothing pushed',
      );
    }
    throw error;
  }

  if (signal.aborted) throw new JobStopped(String(signal.reason));
  const pushed = await git(shell, worktree, [
    'push',
    `--force-with-lease=${lease}`,
    job.repo.url,
    `HEAD:${branchRef}`,
  ]);
  if (!succeeded(pushed)) {
    throw new PublishFailed(`push refused: ${tailOfRun(pushed)}`);
  }

  const github = ctx.githubFor(worktree);
  const open = await github.findPr(branch);
  let prUrl: string;
  if (open?.state === 'open') {
    prUrl = open.url;
    await github.updateBody(open.url, rendered.body, rendered.title);
  } else {
    prUrl = (
      await github.createPr({
        branch,
        base: job.repo.baseBranch,
        title: rendered.title,
        body: rendered.body,
        draft: true,
      })
    ).url;
  }

  await report(
    ctx,
    job,
    { status: 'published', prUrl, commit: commit as CommitSha },
    signal,
  );
};
