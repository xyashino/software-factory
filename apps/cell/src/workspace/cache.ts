import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  describeFailure,
  runShell,
  succeeded,
  type ShellContext,
  type ShellRun,
} from './shell';

/** The marker that says `setup` ran for this commit in this worktree (`.cell/cache-<commit>`). */
export const cacheMarkerOf = (worktree: string, commit: string): string =>
  join(worktree, '.cell', `cache-${commit}`);

export type SyncSetupResult =
  | { ok: true }
  | { ok: false; stage: 'sync' | 'setup'; detail: string; run: ShellRun };

/**
 * Runs the line's `sync` commands on every prepare, then its `setup` commands once per commit: the
 * marker keyed by the commit keeps a second prepare at the same commit from reinstalling dependencies,
 * and a new commit runs `setup` again. A failing command stops the steps and names its stage.
 */
export const syncAndSetup = async (
  ctx: ShellContext,
  input: {
    worktree: string;
    commit: string;
    sync: readonly string[];
    setup: readonly string[];
    timeoutMs: number;
    /** Sees every command as it finishes, the failing one included. */
    record?: (run: ShellRun) => void;
  },
): Promise<SyncSetupResult> => {
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

  const marker = cacheMarkerOf(input.worktree, input.commit);
  if (existsSync(marker)) return { ok: true };

  for (const command of input.setup) {
    const run = await runIn(command);
    if (!succeeded(run)) {
      return {
        ok: false,
        stage: 'setup',
        detail: describeFailure(run, input.timeoutMs),
        run,
      };
    }
  }

  mkdirSync(join(input.worktree, '.cell'), { recursive: true });
  writeFileSync(marker, '');
  return { ok: true };
};
