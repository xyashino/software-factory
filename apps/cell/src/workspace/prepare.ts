import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Job } from '@repo/factory-core/contracts/job';
import { workspaceOf } from '../jobs/job-shape';
import {
  fetchMirror,
  GIT_TIMEOUT_MS,
  mirrorPathOf,
  withMirrorLock,
} from './mirror';
import { syncAndSetup } from './cache';
import { pickEvictions, USED_MARKER } from './lru';
import {
  ensureWorktree,
  removeWorktree,
  worktreePathOf,
  worktreeRootOf,
} from './worktree';
import {
  describeFailure,
  gitCommand,
  runShell,
  succeeded,
  textOf,
  type ShellContext,
  type ShellRun,
} from './shell';

/** The steps of a workspace prepare, in the order `ReportWorkspaceFailed` names them (STORAGE, PROTOCOL §9). */
export type WorkspaceStage = 'fetch' | 'sync' | 'worktree' | 'setup';

export interface PrepareContext {
  shell: ShellContext;
  /** The Cell's data directory: mirrors, worktrees, logs. */
  cellDataDir: string;
  /** Worktrees kept on disk per mirror before the least recently used go. */
  worktreeLimit: number;
  /** Worktree paths a job is using right now; eviction never removes one of them. */
  inUse: Set<string>;
}

export type PrepareResult =
  | { ok: true; worktree: string; head: string }
  | { ok: false; stage: WorkspaceStage; detail: string; log: Uint8Array };

const COMMIT = /^[0-9a-f]{40}$/;
const encoder = new TextEncoder();

const concatBytes = (parts: readonly Uint8Array[]): Uint8Array => {
  const size = parts.reduce((total, part) => total + part.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

/**
 * Prepares the workspace of a Work order job (PROTOCOL §9 step 1), the one path every station, inspection
 * and delivery shares. Per repo there is one bare mirror and per Work order one worktree (`workspace.dir`),
 * so the jobs of one order on one Cell reuse the same `node_modules` and build artifacts.
 *
 * The mirror is fetched (skipped when a pinned base is already in it), the worktree is put detached at
 * `base`, `sync` runs and `setup` runs once per commit, and the least recently used worktrees beyond the
 * limit are evicted. The whole preparation holds the mirror's lock, so two preparations never touch one
 * worktree at once. A failure names its stage and carries the transcript of every command run, for the
 * log blob. The head commit of the worktree is the commit the Cycle starts from.
 */
export const prepareWorkspace = async (
  ctx: PrepareContext,
  job: Job,
): Promise<PrepareResult> => {
  // The Mechanic never gets a Work order worktree (CORE §14.3): reaching this with one is refused.
  if (job.kind === 'mechanic') {
    throw new Error(`mechanic job ${job.jobId} has no worktree`);
  }
  // A station or an inspection reads its pinned base and nothing else, so a base already in the mirror
  // skips the fetch. Delivery reads the branch tip and the base branch from the mirror (the push lease,
  // the rebase), so it always fetches.
  const skipFetchFor =
    job.kind === 'deliver' || typeof job.base !== 'string'
      ? undefined
      : job.base;
  return withMirrorLock(mirrorPathOf(ctx.cellDataDir, job.repo.url), () =>
    prepareLocked(ctx, job, skipFetchFor),
  );
};

const prepareLocked = async (
  ctx: PrepareContext,
  job: Job,
  skipFetchFor: string | undefined,
): Promise<PrepareResult> => {
  const transcript: Uint8Array[] = [];
  const note = (run: ShellRun): void => {
    transcript.push(encoder.encode(`$ ${run.command}\n`), run.output);
  };
  const fail = (stage: WorkspaceStage, detail: string): PrepareResult => ({
    ok: false,
    stage,
    detail,
    log: concatBytes(transcript),
  });
  const workspace = workspaceOf(job);

  const mirror = await fetchMirror(ctx.shell, {
    cellDataDir: ctx.cellDataDir,
    url: job.repo.url,
    ...(skipFetchFor === undefined ? {} : { pinned: skipFetchFor }),
  });
  if (!mirror.ok) {
    transcript.push(mirror.output);
    return fail('fetch', mirror.detail);
  }

  let commit: string;
  if (typeof job.base === 'string') {
    commit = job.base;
  } else {
    const branch = job.base.branchBase;
    const run = await runShell(ctx.shell, {
      command: gitCommand([
        '-C',
        mirror.path,
        'rev-parse',
        '--verify',
        '--quiet',
        `refs/heads/${branch}^{commit}`,
      ]),
      cwd: mirror.path,
      timeoutMs: GIT_TIMEOUT_MS,
    });
    note(run);
    commit = textOf(run).trim();
    if (!succeeded(run) || !COMMIT.test(commit)) {
      return fail('worktree', `branch ${branch} is not in the mirror`);
    }
  }

  const root = worktreeRootOf(ctx.cellDataDir, mirror.path);
  let worktree: string;
  try {
    worktree = worktreePathOf(root, workspace.dir);
  } catch (error) {
    return fail(
      'worktree',
      error instanceof Error ? error.message : String(error),
    );
  }

  const placed = await ensureWorktree(ctx.shell, {
    mirror: mirror.path,
    path: worktree,
    commit,
    timeoutMs: GIT_TIMEOUT_MS,
  });
  if (placed) {
    note(placed);
    return fail('worktree', describeFailure(placed, GIT_TIMEOUT_MS));
  }

  const head = await runShell(ctx.shell, {
    command: gitCommand(['rev-parse', 'HEAD']),
    cwd: worktree,
    timeoutMs: GIT_TIMEOUT_MS,
  });
  note(head);
  const headSha = textOf(head).trim();
  if (!succeeded(head) || !COMMIT.test(headSha)) {
    return fail('worktree', 'the worktree has no HEAD commit');
  }

  const prepared = await syncAndSetup(ctx.shell, {
    worktree,
    commit: headSha,
    sync: workspace.sync,
    setup: workspace.setup,
    timeoutMs: workspace.timeoutMs,
    record: note,
  });
  if (!prepared.ok) return fail(prepared.stage, prepared.detail);

  mkdirSync(join(worktree, '.cell'), { recursive: true });
  writeFileSync(join(worktree, USED_MARKER), '');
  ctx.inUse.add(worktree);

  try {
    const evicted = pickEvictions({
      root,
      limit: ctx.worktreeLimit,
      keep: ctx.inUse,
    });
    for (const path of evicted) {
      await removeWorktree(ctx.shell, {
        mirror: mirror.path,
        path,
        timeoutMs: GIT_TIMEOUT_MS,
      });
    }
  } catch {
    // Eviction is housekeeping: a failure leaves one worktree too many, and the job goes on.
  }

  return { ok: true, worktree, head: headSha };
};
