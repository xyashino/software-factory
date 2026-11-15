import { join } from 'node:path';
import type { Job } from '@repo/factory-core/contracts/job';
import { WireFailure } from '@repo/factory-core/contracts/errors';
import type { BlobRef, CommitSha, PlanId } from '@repo/factory-core/ids';
import type { PlanCommand } from '@repo/factory-core/plan/commands';
import type { GithubPort } from '../ports/github.port';
import {
  ensureMirror,
  GIT_TIMEOUT_MS,
  mirrorPathOf,
} from '../workspace/mirror';
import {
  gitCommand,
  runShell,
  succeeded,
  textOf,
  type ShellContext,
  type ShellRun,
} from '../workspace/shell';
import { redactDetail } from './redact';
import { JobStopped, type JobContext } from './send';

const MAX_DETAIL_CHARS = 500;
const COMMIT = /^[0-9a-f]{40}$/;

/** The last characters of a run's output, for a failure detail, with machine-local values redacted. */
const tailOfRun = (run: ShellRun): string =>
  redactDetail(textOf(run).trim(), MAX_DETAIL_CHARS, 'end');

const errorText = (error: unknown): string =>
  redactDetail(
    error instanceof Error ? error.message : String(error),
    MAX_DETAIL_CHARS,
  );

/** A plan step that cannot finish here: the job reports it as failed, and nothing more is sent. */
class PlanStepFailed extends Error {}

/**
 * Sends one plan command for the job, under its epoch (RULES §3.2: the epoch rides on every write). The
 * commandId names the job and the step, so a retried report replays the stored response. A dry run runs
 * every check and appends nothing (PROTOCOL §8.2). A stale epoch stops the job: nothing more is sent.
 */
const submitPlan = async (
  ctx: JobContext,
  job: Job,
  command: PlanCommand,
  signal: AbortSignal,
  step: 'report' | 'dry' | 'failed' = 'report',
): Promise<void> => {
  if (signal.aborted) throw new JobStopped(String(signal.reason));
  try {
    await ctx.client.call('submitCommand', {
      cellId: ctx.cellId,
      planId: job.orderId as PlanId,
      jobId: job.jobId,
      commandId: `${job.jobId}:${step}`,
      epoch: job.epoch,
      command,
      ...(step === 'dry' ? { dryRun: true } : {}),
    });
  } catch (error) {
    if (error instanceof WireFailure && error.error.code === 'stale_epoch') {
      throw new JobStopped('stale epoch on a plan report; nothing more sent');
    }
    throw error;
  }
};

/** Reports `ReportPlanJobFailed{detail}` for the job. */
const reportFailed = async (
  ctx: JobContext,
  job: Job,
  detail: string,
  signal: AbortSignal,
): Promise<void> => {
  await submitPlan(
    ctx,
    job,
    {
      type: 'ReportPlanJobFailed',
      detail: redactDetail(detail, MAX_DETAIL_CHARS),
    },
    signal,
    'failed',
  );
};

/** Reads a blob as UTF-8 text through the socket. */
const blobText = async (ctx: JobContext, ref: BlobRef): Promise<string> => {
  const answer = await ctx.client.call('blobGet', { ref });
  return Buffer.from(answer.base64, 'base64').toString('utf8');
};

/** Runs one git command in the bare mirror. Plan jobs never make a worktree (PROTOCOL §4). */
const git = (
  shell: ShellContext,
  mirror: string,
  args: readonly string[],
): Promise<ShellRun> =>
  runShell(shell, {
    command: gitCommand(args),
    cwd: mirror,
    timeoutMs: GIT_TIMEOUT_MS,
  });

/** The sha a ref names in the mirror, or undefined when the ref is absent. */
const shaOf = async (
  shell: ShellContext,
  mirror: string,
  ref: string,
): Promise<string | undefined> => {
  const run = await git(shell, mirror, [
    'rev-parse',
    '--verify',
    '--quiet',
    `${ref}^{commit}`,
  ]);
  const sha = textOf(run).trim();
  return succeeded(run) && COMMIT.test(sha) ? sha : undefined;
};

/**
 * `plan_branch` (PROTOCOL §4, CORE §12.5): the plan branch `feat/<slug>` exists at the base, or its tip is
 * reported. Absent: the base must exist, the branch is pushed at the base sha without force, and a push
 * that lost a race is accepted when the branch then stands at a descendant of the base. Present: nothing
 * is pushed. Retried and taken-over runs find the same branch, so they never make a second one.
 */
const runPlanBranch = async (
  ctx: JobContext,
  job: Job,
  shell: ShellContext,
  mirror: string,
  signal: AbortSignal,
): Promise<void> => {
  const branchRef = `refs/heads/${job.repo.branch}`;
  const existing = await shaOf(shell, mirror, branchRef);
  if (existing !== undefined) {
    await submitPlan(
      ctx,
      job,
      { type: 'ReportPlanBranch', commit: existing as CommitSha },
      signal,
    );
    return;
  }

  const base = await shaOf(shell, mirror, `refs/heads/${job.repo.baseBranch}`);
  if (base === undefined) {
    await reportFailed(
      ctx,
      job,
      `branch ${job.repo.baseBranch} is not in the mirror`,
      signal,
    );
    return;
  }

  // A dry run first: a stale epoch stops the job before the push.
  await submitPlan(
    ctx,
    job,
    { type: 'ReportPlanBranch', commit: base as CommitSha },
    signal,
    'dry',
  );

  if (signal.aborted) throw new JobStopped(String(signal.reason));
  const pushed = await git(shell, mirror, [
    'push',
    job.repo.url,
    `${base}:${branchRef}`,
  ]);
  if (!succeeded(pushed)) {
    // The push refused: another run may have made the branch since. Re-read the remote and accept it
    // when it stands at the base or above it; anything else is a failure.
    const refetched = await ensureMirror(shell, {
      cellDataDir: ctx.cellDataDir,
      url: job.repo.url,
    });
    const tip = refetched.ok
      ? await shaOf(shell, mirror, branchRef)
      : undefined;
    const descends =
      tip !== undefined &&
      succeeded(
        await git(shell, mirror, ['merge-base', '--is-ancestor', base, tip]),
      );
    if (tip === undefined || !descends) {
      await reportFailed(
        ctx,
        job,
        `push refused: ${tailOfRun(pushed)}`,
        signal,
      );
      return;
    }
    await submitPlan(
      ctx,
      job,
      { type: 'ReportPlanBranch', commit: tip as CommitSha },
      signal,
    );
    return;
  }

  await submitPlan(
    ctx,
    job,
    { type: 'ReportPlanBranch', commit: base as CommitSha },
    signal,
  );
};

/**
 * `plan_pr` (PROTOCOL §4, CORE §12.5): the plan PR `feat/<slug> -> <baseBranch>` is found, in any state, or
 * opened as a draft with the sub-PR list as its body. Either way its URL is reported. A retried job finds
 * the PR it opened, so it never opens a second one.
 */
const runPlanPr = async (
  ctx: JobContext,
  job: Job,
  github: GithubPort,
  signal: AbortSignal,
): Promise<void> => {
  const plan = job.plan;
  if (!plan) throw new PlanStepFailed('a plan_pr job has no plan block');
  const found = await github.findPr(job.repo.branch, job.repo.baseBranch);
  if (found) {
    await submitPlan(
      ctx,
      job,
      { type: 'ReportPlanPr', prUrl: found.url },
      signal,
    );
    return;
  }
  if (plan.bodyBlob === undefined) {
    await reportFailed(ctx, job, 'plan_pr job has no body blob', signal);
    return;
  }
  const body = await blobText(ctx, plan.bodyBlob);
  const opened = await github.createPr({
    branch: job.repo.branch,
    base: job.repo.baseBranch,
    title: plan.title,
    body,
    draft: true,
  });
  await submitPlan(
    ctx,
    job,
    { type: 'ReportPlanPr', prUrl: opened.url },
    signal,
  );
};

/**
 * `plan_pr_ready` (PROTOCOL §4, CORE §12.5): the sub-PR list is written into the plan PR, then the PR is
 * marked ready. The fence is checked first, with a dry run of the report, so a stale Cell touches nothing
 * on GitHub. `markReady` leaves a PR that is already ready alone, so a retry is safe.
 */
const runPlanPrReady = async (
  ctx: JobContext,
  job: Job,
  github: GithubPort,
  signal: AbortSignal,
): Promise<void> => {
  const plan = job.plan;
  if (!plan?.prUrl) {
    throw new PlanStepFailed('a plan_pr_ready job has no plan PR url');
  }
  await submitPlan(ctx, job, { type: 'ReportPlanReady' }, signal, 'dry');
  if (plan.bodyBlob !== undefined) {
    await github.updateBody(plan.prUrl, await blobText(ctx, plan.bodyBlob));
  }
  await github.markReady(plan.prUrl);
  await submitPlan(ctx, job, { type: 'ReportPlanReady' }, signal);
};

/**
 * Runs one plan job (CORE §12.3, PROTOCOL §4). The mirror is fetched first; a failed fetch reports
 * `ReportPlanJobFailed`. The step runs; a stopped job, a refused wire call or an abort sends nothing more
 * and rethrows. Any other failure reports `ReportPlanJobFailed` best-effort, then rethrows, as a Work
 * order's deliver job does. No worktree is made.
 */
export const runPlanJob = async (
  ctx: JobContext,
  job: Job,
  signal: AbortSignal,
): Promise<void> => {
  if (signal.aborted) return;
  const shell: ShellContext = {
    system: ctx.system,
    logDir: join(ctx.cellDataDir, 'logs', job.jobId),
    signal,
  };

  const mirror = await ensureMirror(shell, {
    cellDataDir: ctx.cellDataDir,
    url: job.repo.url,
  });
  if (!mirror.ok) {
    await reportFailed(ctx, job, `fetch: ${mirror.detail}`, signal);
    return;
  }

  const path = mirrorPathOf(ctx.cellDataDir, job.repo.url);
  try {
    switch (job.kind) {
      case 'plan_branch':
        await runPlanBranch(ctx, job, shell, path, signal);
        return;
      case 'plan_pr':
        await runPlanPr(ctx, job, ctx.githubFor(path), signal);
        return;
      case 'plan_pr_ready':
        await runPlanPrReady(ctx, job, ctx.githubFor(path), signal);
        return;
      default:
        throw new Error(`${job.kind} is not a plan job`);
    }
  } catch (error) {
    if (error instanceof WireFailure || error instanceof JobStopped)
      throw error;
    if (signal.aborted) throw error;
    if (error instanceof PlanStepFailed) {
      await reportFailed(ctx, job, error.message, signal).catch(
        () => undefined,
      );
      return;
    }
    await reportFailed(ctx, job, errorText(error), signal).catch(
      () => undefined,
    );
    throw error;
  }
};
