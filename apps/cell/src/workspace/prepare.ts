import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Job } from '@repo/factory-core/contracts/job';
import { workspaceOf } from '../jobs/job-shape';
import { ensureMirror, GIT_TIMEOUT_MS, withMirrorLock } from './mirror';
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
  /**
   * Fetch the remote even when a pinned base is already in the mirror. Deliver sets it: its push lease reads
   * the remote's branch tip from the mirror, which only a fetch brings up to date.
   */
  alwaysFetch?: boolean;
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
 * Prepares a job's workspace (PROTOCOL §9 step 1): the bare mirror is fetched, the worktree is put at
 * `base`, `sync` and `setup` run (setup once per commit), and the least recently used worktrees beyond
 * the limit are evicted. A failure names its stage and carries the transcript of every command run, for
 * the log blob. The head commit of the worktree is the commit the Cycle starts from.
 */
export const prepareWorkspace = async (
  ctx: PrepareContext,
  job: Job,
): Promise<PrepareResult> => {
  const transcript: Uint8Array[] = [];
  const note = (run: ShellRun): void => {
    transcript.push(encoder.encode(`$ ${run.command}\n`), run.output);
  };
  // The worktree is claimed from the moment it is placed, so no eviction by another Job removes it during setup.
  const claim: { worktree?: string } = {};
  const fail = (stage: WorkspaceStage, detail: string): PrepareResult => {
    if (claim.worktree !== undefined) ctx.inUse.delete(claim.worktree);
    return {
      ok: false,
      stage,
      detail,
      log: concatBytes(transcript),
    };
  };
  const workspace = workspaceOf(job);
  const timeoutMs = workspace.timeoutMs;

  // A pinned base already in the mirror needs no remote fetch (ensureMirror checks); a branch base always fetches.
  const mirror = await ensureMirror(ctx.shell, {
    cellDataDir: ctx.cellDataDir,
    url: job.repo.url,
    ...(typeof job.base === 'string' && ctx.alwaysFetch !== true
      ? { commit: job.base }
      : {}),
  });
  if (!mirror.ok) {
    transcript.push(mirror.output);
    return fail('fetch', mirror.detail);
  }

  let commit: string;
  if (typeof job.base === 'string') {
    commit = job.base;
  } else {
    const run = await runShell(ctx.shell, {
      command: gitCommand([
        '-C',
        mirror.path,
        'rev-parse',
        '--verify',
        '--quiet',
        `refs/heads/${job.base.branchBase}^{commit}`,
      ]),
      cwd: mirror.path,
      timeoutMs: GIT_TIMEOUT_MS,
    });
    note(run);
    commit = textOf(run).trim();
    if (!succeeded(run) || !COMMIT.test(commit)) {
      return fail(
        'worktree',
        `branch ${job.base.branchBase} is not in the mirror`,
      );
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

  claim.worktree = worktree;
  ctx.inUse.add(worktree);

  // Worktree records live in the mirror, so their writes share the mirror lock.
  const placed = await withMirrorLock(mirror.path, () =>
    ensureWorktree(ctx.shell, {
      mirror: mirror.path,
      path: worktree,
      commit,
      timeoutMs: GIT_TIMEOUT_MS,
    }),
  );
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
    timeoutMs,
    record: note,
  });
  if (!prepared.ok) return fail(prepared.stage, prepared.detail);

  mkdirSync(join(worktree, '.cell'), { recursive: true });
  writeFileSync(join(worktree, USED_MARKER), '');

  try {
    const evicted = pickEvictions({
      root,
      limit: ctx.worktreeLimit,
      keep: ctx.inUse,
    });
    await withMirrorLock(mirror.path, async () => {
      for (const path of evicted) {
        await removeWorktree(ctx.shell, {
          mirror: mirror.path,
          path,
          timeoutMs: GIT_TIMEOUT_MS,
        });
      }
    });
  } catch {
    // Eviction is housekeeping: a failure leaves one worktree too many, and the job goes on.
  }

  return { ok: true, worktree, head: headSha };
};
