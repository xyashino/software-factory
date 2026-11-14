import { mkdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import type { Job } from '@repo/factory-core/contracts/job';
import { WireFailure } from '@repo/factory-core/contracts/errors';
import type { BlobRef, CommitSha } from '@repo/factory-core/ids';
import { GIT_TIMEOUT_MS } from '../workspace/mirror';
import { prepareWorkspace } from '../workspace/prepare';
import {
  gitCommand,
  runShell,
  succeeded,
  textOf,
  type ShellContext,
  type ShellRun,
} from '../workspace/shell';
import { JobStopped, submit, type JobContext } from './send';

const MAX_DETAIL_CHARS = 500;
const COMMIT = /^[0-9a-f]{40}$/;

/** The identity of the commits a delivery writes (rebase rewrites and the squash commit). */
const IDENTITY = [
  '-c',
  'user.name=Software Factory',
  '-c',
  'user.email=software-factory@localhost',
];

/** The last characters of a run's output, for a failure detail. */
const tailOfRun = (run: ShellRun): string =>
  textOf(run).trim().slice(-MAX_DETAIL_CHARS);

/**
 * Runs one `deliver` job end to end (PROTOCOL §8.3, CORE §4.3 rule 9). The order is fixed:
 *
 * 1. prepare the workspace at the job's base. A failure reports `ReportDelivery{failed}`.
 * 2. read the branch tip the mirror holds (the Work order's checkpoints) and check it out. An absent
 *    branch is an empty expectation for the lease, and the base stands in for the tip.
 * 3. rebase on `origin/<baseBranch>`. A conflict aborts the rebase and reports `delivery_failed`.
 * 4. squash: `reset --soft` to the rebased base, so the branch's net change is staged.
 * 5. remove the todo file if it is still there, then commit the message from the job.
 * 6. dry-run the push with the lease, then dry-run `ReportDelivery`. A stale epoch stops the job before
 *    the real push.
 * 7. push with `--force-with-lease` on the tip seen in step 2.
 * 8. find the open PR for the branch or create one, then `ReportDelivery{finished}`.
 *
 * A stopped signal or a refusal sends nothing more. An unexpected failure after the workspace is ready
 * reports `ReportDelivery{failed}` best-effort, then rethrows.
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
      cellDataDir: ctx.cellDataDir,
      worktreeLimit: ctx.worktreeLimit,
      inUse: ctx.inUse,
    },
    job,
  );
  if (!prepared.ok) {
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
    ctx.inUse.delete(prepared.worktree);
  }
};

const errorText = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).slice(
    0,
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
      result: { status: 'failed', detail: detail.slice(0, MAX_DETAIL_CHARS) },
    },
    signal,
  );
};

/** Reads a blob as UTF-8 text through the socket. */
const blobText = async (ctx: JobContext, ref: BlobRef): Promise<string> => {
  const answer = await ctx.client.call('blobGet', { ref });
  return Buffer.from(answer.base64, 'base64').toString('utf8');
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

/** A todo path the delivery may remove: relative, and no `..` segment, so it stays inside the repo. */
const isRepoRelative = (path: string): boolean =>
  path !== '' && !isAbsolute(path) && !path.split(/[\\/]/).includes('..');

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
  const baseRef = `refs/heads/${job.repo.baseBranch}`;
  const branchRef = `refs/heads/${branch}`;

  if (!isRepoRelative(deliver.removeTodo)) {
    throw new DeliveryFailed(
      `todo path is not a relative path inside the repo: ${deliver.removeTodo}`,
    );
  }

  const baseRun = await git(shell, worktree, [
    'rev-parse',
    '--verify',
    '--quiet',
    `${baseRef}^{commit}`,
  ]);
  if (!succeeded(baseRun)) {
    throw new DeliveryFailed(
      `branch ${job.repo.baseBranch} is not in the mirror`,
    );
  }

  const tipRun = await git(shell, worktree, [
    'rev-parse',
    '--verify',
    '--quiet',
    `${branchRef}^{commit}`,
  ]);
  const remoteTip = succeeded(tipRun) ? textOf(tipRun).trim() : '';
  const startAt = remoteTip === '' ? head : remoteTip;
  const placed = await git(shell, worktree, [
    'checkout',
    '--force',
    '--detach',
    startAt,
  ]);
  if (!succeeded(placed)) {
    throw new DeliveryFailed(
      `checkout of ${startAt} failed: ${tailOfRun(placed)}`,
    );
  }

  const rebased = await git(shell, worktree, [...IDENTITY, 'rebase', baseRef]);
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

  const squashed = await git(shell, worktree, ['reset', '--soft', baseRef]);
  if (!succeeded(squashed)) {
    throw new DeliveryFailed(`squash failed: ${tailOfRun(squashed)}`);
  }

  await git(shell, worktree, [
    'rm',
    '-f',
    '--ignore-unmatch',
    '--',
    deliver.removeTodo,
  ]);

  const staged = await git(shell, worktree, [
    'diff',
    '--cached',
    '--name-only',
  ]);
  if (textOf(staged).trim() === '') {
    await reportFailed(ctx, job, 'nothing to deliver', signal);
    return;
  }

  const logDir = shell.logDir;
  mkdirSync(logDir, { recursive: true });
  const messageFile = join(logDir, 'commit-message.txt');
  writeFileSync(messageFile, `${deliver.commitMessage}\n`);
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
  const body = await blobText(ctx, deliver.bodyBlob);

  // The push goes to the repo URL, not to `origin`: the mirror is a `--mirror` clone, and git refuses an
  // explicit refspec on a mirror remote.
  const dryPush = await git(shell, worktree, [
    'push',
    '--dry-run',
    `--force-with-lease=${lease}`,
    job.repo.url,
    `HEAD:${branchRef}`,
  ]);
  if (!succeeded(dryPush)) {
    await reportFailed(ctx, job, `push refused: ${tailOfRun(dryPush)}`, signal);
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
    await reportFailed(ctx, job, `push refused: ${tailOfRun(pushed)}`, signal);
    return;
  }

  const github = ctx.githubFor(worktree);
  const open = await github.findPr(branch);
  const prUrl =
    open?.state === 'open'
      ? open.url
      : (
          await github.createPr({
            branch,
            base: job.repo.baseBranch,
            title: deliver.title,
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
};
