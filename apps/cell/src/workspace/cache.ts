import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  describeFailure,
  runShell,
  succeeded,
  type ShellContext,
  type ShellRun,
} from './shell';

/** The marker that says a changeover ran for this commit in this worktree (`.cell/cache-<commit>`). */
export const cacheMarkerOf = (worktree: string, commit: string): string =>
  join(worktree, '.cell', `cache-${commit}`);

/**
 * The marker of a changeover keyed by its key files' digest (`.cell/cache-kf-<digest>`): the same key files at any
 * commit share it, so a commit that does not touch them runs no changeover again.
 */
export const keyedMarkerOf = (worktree: string, digest: string): string =>
  join(worktree, '.cell', `cache-kf-${digest}`);

export type SyncChangeoverResult =
  | { ok: true }
  | {
      ok: false;
      stage: 'sync' | 'changeover';
      detail: string;
      run: ShellRun;
    };

/**
 * Runs the Job's `sync` commands on every prepare, then its `changeover` commands once per marker. A marker that
 * exists skips the changeover, and the changeover writes it only after every command succeeds. An empty changeover
 * runs nothing and writes no marker. A failing command stops the steps and names its stage.
 */
export const syncAndChangeover = async (
  ctx: ShellContext,
  input: {
    worktree: string;
    /** The marker that says this changeover already ran (see `cacheMarkerOf`, `keyedMarkerOf`). */
    marker: string;
    sync: readonly string[];
    changeover: readonly string[];
    timeoutMs: number;
    /** Sees every command as it finishes, the failing one included. */
    record?: (run: ShellRun) => void;
  },
): Promise<SyncChangeoverResult> => {
  const runIn = async (command: string): Promise<ShellRun> => {
    const finished = await runShell(ctx, {
      command,
      cwd: input.worktree,
      timeoutMs: input.timeoutMs,
    });
    input.record?.(finished);
    return finished;
  };

  for (const command of input.sync) {
    const run = await runIn(command);
    if (!succeeded(run)) {
      return {
        ok: false,
        stage: 'sync',
        detail: describeFailure(run, input.timeoutMs),
        run,
      };
    }
  }

  if (input.changeover.length === 0) return { ok: true };
  if (existsSync(input.marker)) return { ok: true };

  for (const command of input.changeover) {
    const run = await runIn(command);
    if (!succeeded(run)) {
      return {
        ok: false,
        stage: 'changeover',
        detail: describeFailure(run, input.timeoutMs),
        run,
      };
    }
  }

  mkdirSync(join(input.worktree, '.cell'), { recursive: true });
  writeFileSync(input.marker, '');
  return { ok: true };
};
