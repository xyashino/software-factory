import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { workspaceOf } from './jobs/job-shape';
import { join } from 'node:path';
import type { Job } from '@repo/factory-core/contracts/job';
import type { CommitSha } from '@repo/factory-core/ids';
import { CELL_DIR } from './checkpoint';
import { runGit } from './git';
import { runShell } from './shell';
import type { RunGit, RunShell } from './ports';

export type WorkspaceResult =
  | { ok: true; worktree: string; base: CommitSha }
  | {
      ok: false;
      stage: 'fetch' | 'sync' | 'worktree' | 'setup';
      detail: string;
    };

/** The file in the Cell scratch that names the base a worktree was last prepared at. */
const PREPARED = join(CELL_DIR, 'prepared');

/** The mirror preparations in flight, by mirror path: the next one for a path waits for the one before. */
const mirrorTurns = new Map<string, Promise<unknown>>();

/** The Work order's todo part of `<project>:<todo>` (CORE §3). */
const todoOf = (orderId: string): string =>
  orderId.slice(orderId.indexOf(':') + 1);

/** A directory name for one Work order: letters, digits, dot, dash, underscore. */
const dirOf = (orderId: string): string =>
  orderId.replace(/[^a-zA-Z0-9._-]/g, '_');

/** Adds `.cell/` to the mirror's exclude file once, so no target repository needs a .gitignore. */
const excludeCell = (mirror: string): void => {
  const path = join(mirror, 'info', 'exclude');
  mkdirSync(join(mirror, 'info'), { recursive: true });
  const current = existsSync(path) ? readFileSync(path, 'utf8') : '';
  if (!current.split('\n').includes(`${CELL_DIR}/`)) {
    appendFileSync(path, `${CELL_DIR}/\n`);
  }
};

/** Runs `work` after the mirror preparations queued before it for the same mirror path. */
const withMirrorLock = <T>(
  mirror: string,
  work: () => Promise<T>,
): Promise<T> => {
  const previous = mirrorTurns.get(mirror) ?? Promise.resolve();
  const turn = previous.then(() => work());
  mirrorTurns.set(
    mirror,
    turn.catch(() => undefined),
  );
  return turn;
};

/**
 * Runs the job's `sync` then `setup` lines in the worktree, each bounded by the workspace timeout.
 * The first line that fails names its stage and stops the rest.
 */
const runLines = async (
  shell: RunShell,
  worktree: string,
  lines: readonly string[],
  timeoutMs: number,
): Promise<string | undefined> => {
  for (const line of lines) {
    const ran = await shell(worktree, line, timeoutMs);
    if (!ran.ok) return `${line}: ${ran.detail}`;
  }
  return undefined;
};

/**
 * Prepares the worktree of a station (PROTOCOL §9 step 1): fetch the bare mirror, create or reset the
 * worktree at the job's base on the Work order's branch, then run `sync` and `setup` unless the
 * worktree is already prepared at that base. The failure stages are `fetch`, `worktree`, `sync` and
 * `setup`.
 */
export const prepareWorkspace = async (input: {
  job: Job;
  dataDir: string;
  git?: RunGit;
  shell?: RunShell;
}): Promise<WorkspaceResult> => {
  const git = input.git ?? runGit;
  const shell = input.shell ?? runShell;
  const { job, dataDir } = input;
  const workspace = workspaceOf(job);
  const mirror = join(dataDir, 'repos', `${job.projectId}.git`);
  mkdirSync(join(dataDir, 'repos'), { recursive: true });

  // The mirror lives in this instance directory, so only this Cell's own work reads it. The lock keeps
  // concurrent preparations of one repo in turn, so the first clone is finished before a second fetch reads it.
  const fetched = await withMirrorLock(mirror, async () => {
    if (!existsSync(join(mirror, 'HEAD'))) {
      // Cloned under a temporary name and renamed into place, so a Cell killed mid-clone leaves no
      // half mirror at the real path.
      const partial = `${mirror}.partial-${process.pid}-${Date.now()}`;
      const cloned = await git(dataDir, [
        'clone',
        '--mirror',
        '--quiet',
        job.repo.url,
        partial,
      ]);
      if (cloned.code !== 0) {
        rmSync(partial, { recursive: true, force: true });
        return cloned;
      }
      // A mirror remote pushes everything and refuses explicit refspecs, and it fetches into
      // refs/heads, where the worktrees live. The Cell keeps the remote's branches apart, under
      // refs/remotes/origin/*, so a fetch never writes to a branch a worktree has checked out.
      await git(partial, ['config', 'remote.origin.mirror', 'false']);
      await git(partial, [
        'config',
        'remote.origin.fetch',
        '+refs/heads/*:refs/remotes/origin/*',
      ]);
      renameSync(partial, mirror);
    }
    const pulled = await git(mirror, ['fetch', '--quiet', '--prune', 'origin']);
    excludeCell(mirror);
    return pulled;
  });
  if (fetched.code !== 0)
    return { ok: false, stage: 'fetch', detail: fetched.stderr.trim() };

  let base: CommitSha;
  if (typeof job.base === 'string') {
    base = job.base as CommitSha;
  } else {
    const resolved = await git(mirror, [
      'rev-parse',
      '--verify',
      `refs/remotes/origin/${job.base.branchBase}^{commit}`,
    ]);
    if (resolved.code !== 0) {
      return {
        ok: false,
        stage: 'worktree',
        detail: `base branch ${job.base.branchBase} is missing`,
      };
    }
    base = resolved.stdout.trim() as CommitSha;
  }

  const branch = `factory/${todoOf(job.orderId)}`;
  const worktree = join(dataDir, 'worktrees', dirOf(job.orderId));
  mkdirSync(join(dataDir, 'worktrees'), { recursive: true });
  if (existsSync(worktree)) {
    // A worktree left by an earlier Cycle is reset to the base: its leftovers go, the Cell scratch stays.
    const moved = await git(worktree, [
      'checkout',
      '--quiet',
      '-B',
      branch,
      base,
    ]);
    if (moved.code !== 0) {
      return { ok: false, stage: 'worktree', detail: moved.stderr.trim() };
    }
    await git(worktree, ['reset', '--quiet', '--hard', base]);
    await git(worktree, ['clean', '--quiet', '-fd', '-e', `${CELL_DIR}/`]);
  } else {
    const added = await git(mirror, [
      'worktree',
      'add',
      '--quiet',
      '-B',
      branch,
      worktree,
      base,
    ]);
    if (added.code !== 0)
      return { ok: false, stage: 'worktree', detail: added.stderr.trim() };
  }
  mkdirSync(join(worktree, CELL_DIR), { recursive: true });

  const preparedAt = existsSync(join(worktree, PREPARED))
    ? readFileSync(join(worktree, PREPARED), 'utf8').trim()
    : '';
  if (preparedAt !== base) {
    const syncFailure = await runLines(
      shell,
      worktree,
      workspace.sync,
      workspace.timeoutMs,
    );
    if (syncFailure !== undefined) {
      return { ok: false, stage: 'sync', detail: syncFailure };
    }
    const setupFailure = await runLines(
      shell,
      worktree,
      workspace.setup,
      workspace.timeoutMs,
    );
    if (setupFailure !== undefined) {
      return { ok: false, stage: 'setup', detail: setupFailure };
    }
    writeFileSync(join(worktree, PREPARED), `${base}\n`);
  }
  return { ok: true, worktree, base };
};
