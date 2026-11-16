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
import {
  ensureWorktree,
  removeWorktree,
  worktreePathOf,
  worktreePresent,
} from './worktree';

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
  | {
      ok: false;
      stage: WorkspaceStage;
      detail: string;
      log: Uint8Array;
      /**
       * A `reuse` job found no worktree on this Cell (PROTOCOL §9): the Cell reports `worktree_missing`
       * instead of a workspace failure, and nothing was created or set up.
       */
      missing?: boolean;
    };

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
  | { ok: false; stage: WorkspaceStage; detail: string; missing?: boolean };

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

type Base = { ok: true; commit: string } | { ok: false; detail: string };

/** The commit a `fresh` worktree is placed at: the job's commit, or the tip of the base branch on origin. */
const resolveBase = async (
  ctx: PrepareContext,
  job: Job,
  note: (run: ShellRun) => void,
): Promise<Base> => {
  if (typeof job.base === 'string') return { ok: true, commit: job.base };
  // The remote's branches live under refs/remotes/origin/*: the repo's own branches are never read here.
  const resolved = await gitIn(ctx.shell, ctx.repoRoot, [
    'rev-parse',
    '--verify',
    '--quiet',
    `refs/remotes/origin/${job.base.branchBase}^{commit}`,
  ]);
  note(resolved);
  const commit = textOf(resolved).trim();
  if (!succeeded(resolved) || !COMMIT.test(commit)) {
    return {
      ok: false,
      detail: `branch ${job.base.branchBase} is missing on origin`,
    };
  }
  return { ok: true, commit };
};

/**
 * The git steps that write to the repo, run under the repo lock: fetch `origin`, then place the worktree
 * (`fresh`: at its base, discarding what was there; `reuse`: as it is, or missing), then evict. The worktree
 * is leased on success; the caller releases it.
 */
const placeWorktree = async (
  ctx: PrepareContext,
  job: Job,
  note: (run: ShellRun) => void,
): Promise<Placed> => {
  const { repoRoot } = ctx;
  const workspace = workspaceOf(job);
  const mode = workspace.mode ?? 'fresh';
  const fail = (
    stage: WorkspaceStage,
    detail: string,
    missing = false,
  ): Placed => ({
    ok: false,
    stage,
    detail,
    ...(missing ? { missing: true } : {}),
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

  let commit = '';
  if (mode === 'fresh') {
    const base = await resolveBase(ctx, job, note);
    if (!base.ok) return fail('worktree', base.detail);
    commit = base.commit;
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

  if (mode === 'reuse') {
    // The uncommitted work of earlier Stations lives in this worktree: it is never reset, and a missing one
    // is not created here (the Work order restarts from Station 0 instead, CORE §4.3 rule 13).
    if (!worktreePresent(worktree)) {
      lease.release();
      return fail(
        'worktree',
        `worktree ${workspace.dir} is not on this cell`,
        true,
      );
    }
  } else {
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
    if (mode === 'fresh') {
      // The metadata marker of a fresh placement: which Work order and base commit the worktree belongs to.
      writeFileSync(
        join(worktree, '.cell', 'worktree.json'),
        JSON.stringify({ orderId: job.orderId, baseCommit: commit }),
      );
    }
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
 * Prepares a job's workspace (PROTOCOL §9 step 1). The repo's `origin` is fetched, then the job's worktree
 * under `<repoRoot>/.worktrees/` is placed by its mode: `fresh` at its base (`checkout --force`, `clean`,
 * with the `.cell/worktree.json` marker), `reuse` as it is, never reset, and missing when it is not on this
 * Cell. `sync` runs for a fresh placement only (it may touch the tree); `setup` runs once per commit. The
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
  const fail = (
    stage: WorkspaceStage,
    detail: string,
    missing = false,
  ): PrepareResult => ({
    ok: false,
    stage,
    detail,
    log: concatBytes(transcript),
    ...(missing ? { missing: true } : {}),
  });
  const workspace = workspaceOf(job);
  const mode = workspace.mode ?? 'fresh';

  const placed = await withRepoLock(ctx.repoRoot, () =>
    placeWorktree(ctx, job, note),
  );
  if (!placed.ok) return fail(placed.stage, placed.detail, placed.missing);

  const { worktree, head, lease } = placed;
  const release = (): void => {
    ctx.inUse.delete(worktree);
    lease.release();
  };
  try {
    const prepared = await syncAndSetup(ctx.shell, {
      worktree,
      commit: head,
      // A reused worktree holds uncommitted work: its `sync` commands may rewrite the tree, so they do not run.
      sync: mode === 'fresh' ? workspace.sync : [],
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
