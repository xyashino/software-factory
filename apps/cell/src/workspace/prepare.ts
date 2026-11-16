import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Job } from '@repo/factory-core/contracts/job';
import { workspaceOf } from '../jobs/job-shape';
import { syncAndSetup } from './cache';
import { evictionPlan, USED_MARKER } from './lru';
import { tryLockWorktree, withRepoLock, type Lease } from './repo-lock';
import {
  ensureCellExcluded,
  GIT_TIMEOUT_MS,
  gitIn,
  worktreesRootOf,
} from './repo';
import {
  describeFailure,
  succeeded,
  textOf,
  type ShellContext,
  type ShellRun,
} from './shell';
import { ensureWorktree, removeWorktree, worktreePathOf } from './worktree';

/** The steps of a workspace prepare, in the order `ReportWorkspaceFailed` names them (STORAGE, PROTOCOL §9). */
export type WorkspaceStage = 'fetch' | 'sync' | 'worktree' | 'setup';

export interface PrepareContext {
  shell: ShellContext;
  /** The repo the Cell works in. Worktrees are made from its `.git` under `<repoRoot>/.worktrees/`. */
  repoRoot: string;
  /** Worktrees kept on disk under the repo before the least recently used go. */
  worktreeLimit: number;
  /** Worktree paths a job is using right now; eviction never removes one of them. */
  inUse: Set<string>;
}

export type PrepareResult =
  | {
      ok: true;
      worktree: string;
      head: string;
      /** Ends the job's use of the worktree: it may be evicted again. Call once, when the job ends. */
      release: () => void;
    }
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

type Placed =
  | { ok: true; worktree: string; head: string; lease: Lease }
  | { ok: false; stage: WorkspaceStage; detail: string };

/**
 * Removes the least recently used worktrees over the limit. A worktree this Cell is using is kept, and so
 * is one another Cell instance holds (its in-use lease cannot be taken). Housekeeping: a failure leaves a
 * worktree too many, and the job goes on.
 */
const evictLeastRecentlyUsed = async (ctx: PrepareContext): Promise<void> => {
  try {
    const plan = evictionPlan({
      root: worktreesRootOf(ctx.repoRoot),
      limit: ctx.worktreeLimit,
      keep: ctx.inUse,
    });
    let removed = 0;
    for (const path of plan.candidates) {
      if (removed >= plan.excess) break;
      const busy = tryLockWorktree(ctx.repoRoot, path);
      if (busy === undefined) continue;
      try {
        await removeWorktree(ctx.shell, { repoRoot: ctx.repoRoot, path });
        removed += 1;
      } finally {
        busy.release();
      }
    }
  } catch {
    // Eviction is housekeeping: a failure leaves one worktree too many, and the job goes on.
  }
};

/**
 * The git steps that write to the repo, run under the repo lock: fetch `origin`, resolve the base,
 * lease and place the worktree, then evict. The worktree is leased on success; the caller releases it.
 */
const placeWorktree = async (
  ctx: PrepareContext,
  job: Job,
  note: (run: ShellRun) => void,
): Promise<Placed> => {
  const { repoRoot } = ctx;
  const workspace = workspaceOf(job);
  const fail = (stage: WorkspaceStage, detail: string): Placed => ({
    ok: false,
    stage,
    detail,
  });

  const excluded = await ensureCellExcluded(ctx.shell, repoRoot);
  note(excluded);
  if (!succeeded(excluded)) {
    return fail('fetch', describeFailure(excluded, GIT_TIMEOUT_MS));
  }

  const fetched = await gitIn(ctx.shell, repoRoot, [
    'fetch',
    '--quiet',
    '--prune',
    'origin',
  ]);
  note(fetched);
  if (!succeeded(fetched)) {
    return fail('fetch', describeFailure(fetched, GIT_TIMEOUT_MS));
  }

  let commit: string;
  if (typeof job.base === 'string') {
    commit = job.base;
  } else {
    // The remote's branches live under refs/remotes/origin/*: the repo's own branches are never read here.
    const resolved = await gitIn(ctx.shell, repoRoot, [
      'rev-parse',
      '--verify',
      '--quiet',
      `refs/remotes/origin/${job.base.branchBase}^{commit}`,
    ]);
    note(resolved);
    commit = textOf(resolved).trim();
    if (!succeeded(resolved) || !COMMIT.test(commit)) {
      return fail(
        'worktree',
        `branch ${job.base.branchBase} is missing on origin`,
      );
    }
  }

  const root = worktreesRootOf(repoRoot);
  let worktree: string;
  try {
    worktree = worktreePathOf(root, workspace.dir);
  } catch (error) {
    return fail(
      'worktree',
      error instanceof Error ? error.message : String(error),
    );
  }

  // Another Cell instance (or a job of this one) that holds the worktree's lease is never reset under it.
  const lease = tryLockWorktree(repoRoot, worktree);
  if (lease === undefined) {
    return fail(
      'worktree',
      `worktree ${workspace.dir} is in use by another job`,
    );
  }

  const placed = await ensureWorktree(ctx.shell, {
    repoRoot,
    path: worktree,
    commit,
    timeoutMs: GIT_TIMEOUT_MS,
  });
  if (placed) {
    note(placed);
    lease.release();
    return fail('worktree', describeFailure(placed, GIT_TIMEOUT_MS));
  }

  const head = await gitIn(ctx.shell, worktree, ['rev-parse', 'HEAD']);
  note(head);
  const headSha = textOf(head).trim();
  if (!succeeded(head) || !COMMIT.test(headSha)) {
    lease.release();
    return fail('worktree', 'the worktree has no HEAD commit');
  }

  try {
    mkdirSync(join(worktree, '.cell'), { recursive: true });
    writeFileSync(join(worktree, USED_MARKER), '');
    ctx.inUse.add(worktree);
  } catch (error) {
    lease.release();
    throw error;
  }

  await evictLeastRecentlyUsed(ctx);
  return { ok: true, worktree, head: headSha, lease };
};

/**
 * Prepares a job's workspace (PROTOCOL §9 step 1). The repo's `origin` is fetched, the job's worktree is
 * put at its base under `<repoRoot>/.worktrees/`, `sync` and `setup` run (setup once per commit), and the
 * least recently used worktrees beyond the limit are evicted. The repo's own checkout is never touched.
 * A failure names its stage and carries the transcript of every command run, for the log blob. The head
 * commit of the worktree is the commit the Cycle starts from. The worktree stays leased until `release`.
 */
export const prepareWorkspace = async (
  ctx: PrepareContext,
  job: Job,
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

  const placed = await withRepoLock(ctx.repoRoot, () =>
    placeWorktree(ctx, job, note),
  );
  if (!placed.ok) return fail(placed.stage, placed.detail);

  const { worktree, head, lease } = placed;
  const release = (): void => {
    ctx.inUse.delete(worktree);
    lease.release();
  };
  try {
    const prepared = await syncAndSetup(ctx.shell, {
      worktree,
      commit: head,
      sync: workspace.sync,
      setup: workspace.setup,
      timeoutMs: workspace.timeoutMs,
      record: note,
    });
    if (!prepared.ok) {
      release();
      return fail(prepared.stage, prepared.detail);
    }
  } catch (error) {
    release();
    throw error;
  }

  return { ok: true, worktree, head, release };
};
