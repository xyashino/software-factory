import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  adrSectionOf,
  PR_ADR_TOKEN,
  type Job,
} from '@repo/factory-core/contracts/job';
import { WireFailure } from '@repo/factory-core/contracts/errors';
import type { CommitSha } from '@repo/factory-core/ids';
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
import { getBlob } from './blobs';
import { redactDetail } from './redact';
import { RenderFailed, renderDelivery, type RenderedDelivery } from './render';
import { JobStopped, submit, type JobContext } from './send';

const MAX_DETAIL_CHARS = 500;
const COMMIT = /^[0-9a-f]{40}$/;

/** The identity of the commits a delivery writes (the staging commit, its rebase and the squash commit). */
const IDENTITY = [
  '-c',
  'user.name=Software Factory',
  '-c',
  'user.email=software-factory@localhost',
];

/** The last characters of a run's output, for a failure detail, with machine-local values redacted. */
const tailOfRun = (run: ShellRun): string =>
  redactDetail(textOf(run).trim(), MAX_DETAIL_CHARS, 'end');

/**
 * Runs one `deliver` job end to end (PROTOCOL §8.3, CORE §4.3 rule 9). The worktree is reused, never
 * checked out over: the uncommitted work of every Station is delivered as it stands. The order is fixed:
 *
 * 1. prepare the workspace in `reuse` mode. A worktree this Cell does not hold reports
 *    `ReportWorktreeMissing`, so the Work order restarts from Station 0; any other failure reports
 *    `ReportDelivery{failed}`.
 * 2. stage every change (`.cell/` is excluded), and remove the todo file if it is still there.
 * 3. commit the staging on top of the worktree's HEAD, rebase it on `origin/<baseBranch>` (a conflict
 *    aborts the rebase and reports `delivery_failed`), then squash it to one commit on the base with the
 *    rendered delivery message (`reset --soft` + `commit`).
 * 4. read the branch tip origin holds, dry-run the push with the lease, then dry-run `ReportDelivery`.
 *    A stale epoch stops the job before the real push.
 * 5. push `factory/<todoId>` with `--force-with-lease` on the tip seen in step 4, then find the open PR
 *    for the branch or create one, then `ReportDelivery{finished}`.
 *
 * Until the push succeeds, a failed delivery puts HEAD back on the commit it started from, so origin never
 * needs a commit only this Cell has. The uncommitted work stays in the worktree. A stopped signal or a
 * refusal sends nothing more.
 */
export const runDeliver = async (
  ctx: JobContext,
  job: Job,
  signal: AbortSignal,
): Promise<void> => {
  const deliver = job.deliver;
  if (!deliver)
    throw new Error(`deliver job ${job.jobId} has no deliver block`);
  if (signal.aborted) return;

  const shell: ShellContext = {
    system: ctx.system,
    logDir: join(ctx.cellDataDir, 'logs', job.jobId),
    signal,
  };

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
    if (prepared.missing) {
      await submit(
        ctx,
        job,
        { type: 'ReportWorktreeMissing', detail: prepared.detail },
        signal,
      );
      return;
    }
    await reportFailed(
      ctx,
      job,
      `workspace ${prepared.stage}: ${prepared.detail}`,
      signal,
    );
    return;
  }

  try {
    await deliverWorktree(
      ctx,
      job,
      deliver,
      shell,
      prepared.worktree,
      prepared.head,
      signal,
    );
  } catch (error) {
    if (error instanceof WireFailure || error instanceof JobStopped)
      throw error;
    if (signal.aborted) throw error;
    if (error instanceof DeliveryFailed) {
      await reportFailed(ctx, job, error.message, signal);
      return;
    }
    await reportFailed(ctx, job, errorText(error), signal).catch(
      () => undefined,
    );
    throw error;
  } finally {
    prepared.release();
  }
};

const errorText = (error: unknown): string =>
  redactDetail(
    error instanceof Error ? error.message : String(error),
    MAX_DETAIL_CHARS,
  );

/** Sends `ReportDelivery{failed, detail}` for the job. */
const reportFailed = async (
  ctx: JobContext,
  job: Job,
  detail: string,
  signal: AbortSignal,
): Promise<void> => {
  await submit(
    ctx,
    job,
    {
      type: 'ReportDelivery',
      result: {
        status: 'failed',
        detail: redactDetail(detail, MAX_DETAIL_CHARS),
      },
    },
    signal,
  );
};

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

/** A delivery that cannot finish here: the job reports it as failed, and nothing is pushed. */
class DeliveryFailed extends Error {}

const deliverWorktree = async (
  ctx: JobContext,
  job: Job,
  deliver: NonNullable<Job['deliver']>,
  shell: ShellContext,
  worktree: string,
  head: string,
  signal: AbortSignal,
): Promise<void> => {
  const branch = job.repo.branch;
  // The remote's branches as the prepare's fetch saw them (refs/remotes/origin/*). The lease and the push
  // name the same branch on the remote, so they use refs/heads/*.
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
    throw new DeliveryFailed(
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

  // Every change of the worktree goes into the delivery. An intake order's todo file leaves with it; an
  // API-created order has none, so nothing is removed.
  const staged = await git(shell, worktree, ['add', '-A', '--', '.']);
  if (!succeeded(staged)) {
    throw new DeliveryFailed(`staging failed: ${tailOfRun(staged)}`);
  }
  const todoPath = `todos/${deliver.taskId}.md`;
  if (existsSync(join(worktree, todoPath))) {
    await git(shell, worktree, ['rm', '-f', '--', todoPath]);
  }

  let delivered = false;
  try {
    const staging = await git(shell, worktree, [
      ...IDENTITY,
      'commit',
      '--quiet',
      '--allow-empty',
      '--no-verify',
      '-m',
      'staging delivery',
    ]);
    if (!succeeded(staging)) {
      throw new DeliveryFailed(`staging commit failed: ${tailOfRun(staging)}`);
    }

    const rebased = await git(shell, worktree, [
      ...IDENTITY,
      'rebase',
      baseRef,
    ]);
    if (!succeeded(rebased)) {
      await git(shell, worktree, ['rebase', '--abort']);
      await reportFailed(
        ctx,
        job,
        `rebase conflict: ${tailOfRun(rebased)}`,
        signal,
      );
      return;
    }

    // The commit, the PR title and the PR body come from the repo's own `.factory/` on this worktree (PROTOCOL §4).
    let rendered: RenderedDelivery;
    try {
      rendered = await renderDelivery({
        deliver,
        worktree,
        blobs: (ref) => getBlob(ctx.client, ref),
      });
    } catch (error) {
      if (!(error instanceof RenderFailed)) throw error;
      await reportFailed(ctx, job, error.message, signal);
      return;
    }

    const squashed = await git(shell, worktree, ['reset', '--soft', baseRef]);
    if (!succeeded(squashed)) {
      throw new DeliveryFailed(`squash failed: ${tailOfRun(squashed)}`);
    }

    const stagedNames = await git(shell, worktree, [
      'diff',
      '--cached',
      '--name-only',
    ]);
    if (textOf(stagedNames).trim() === '') {
      await reportFailed(ctx, job, 'nothing to deliver', signal);
      return;
    }

    const logDir = shell.logDir;
    mkdirSync(logDir, { recursive: true });
    const messageFile = join(logDir, 'commit-message.txt');
    writeFileSync(messageFile, `${rendered.commitMessage}\n`);
    const committed = await git(shell, worktree, [
      ...IDENTITY,
      'commit',
      '--file',
      messageFile,
    ]);
    if (!succeeded(committed)) {
      throw new DeliveryFailed(`commit failed: ${tailOfRun(committed)}`);
    }
    const headRun = await git(shell, worktree, ['rev-parse', 'HEAD']);
    const commit = textOf(headRun).trim();
    if (!succeeded(headRun) || !COMMIT.test(commit)) {
      throw new DeliveryFailed('the delivery commit has no sha');
    }

    const lease = `${branchRef}:${remoteTip}`;
    // The ADR section is the Cell's to fill (v1 PR format): the `decisions/` entries this commit adds.
    const added = await git(shell, worktree, [
      'diff',
      '--name-only',
      '--diff-filter=A',
      'HEAD~1',
      'HEAD',
      '--',
      'decisions/',
    ]);
    const decisions = succeeded(added)
      ? textOf(added)
          .split('\n')
          .map((path) => path.trim())
          .filter((path) => /^decisions\/.+\.md$/.test(path))
      : [];
    const body = rendered.body
      .split(PR_ADR_TOKEN)
      .join(adrSectionOf(decisions));

    // The push goes to the job's repo URL: the same remote `origin` names.
    const dryPush = await git(shell, worktree, [
      'push',
      '--dry-run',
      `--force-with-lease=${lease}`,
      job.repo.url,
      `HEAD:${branchRef}`,
    ]);
    if (!succeeded(dryPush)) {
      await reportFailed(
        ctx,
        job,
        `push refused: ${tailOfRun(dryPush)}`,
        signal,
      );
      return;
    }

    // A dry run of the report: the same checks as the real one, nothing appended. The PR does not exist
    // yet, so the dry run names the failed result; the fence and the order state are checked either way.
    try {
      await submit(
        ctx,
        job,
        {
          type: 'ReportDelivery',
          result: { status: 'failed', detail: 'dry run before the push' },
        },
        signal,
        { dryRun: true },
      );
    } catch (error) {
      if (error instanceof WireFailure && error.error.code === 'stale_epoch') {
        throw new JobStopped(
          'stale epoch on the delivery dry run; nothing pushed',
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
      await reportFailed(
        ctx,
        job,
        `push refused: ${tailOfRun(pushed)}`,
        signal,
      );
      return;
    }
    delivered = true;

    const github = ctx.githubFor(worktree);
    const open = await github.findPr(branch);
    const prUrl =
      open?.state === 'open'
        ? open.url
        : (
            await github.createPr({
              branch,
              base: job.repo.baseBranch,
              title: rendered.title,
              body,
              draft: false,
            })
          ).url;

    await submit(
      ctx,
      job,
      {
        type: 'ReportDelivery',
        result: { status: 'finished', prUrl, commit: commit as CommitSha },
      },
      signal,
    );
  } finally {
    // Until the push lands, HEAD goes back to the commit the worktree started from: origin must not
    // need a commit only this Cell holds. The work stays in the worktree.
    if (!delivered) {
      await git(shell, worktree, ['reset', '--mixed', head]).catch(
        () => undefined,
      );
    }
  }
};
