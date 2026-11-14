import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  describeFailure,
  gitCommand,
  runShell,
  succeeded,
  type ShellContext,
} from './shell';

/** Git operations on the mirror may take this long; a repo fetch is the slow one. */
export const GIT_TIMEOUT_MS = 120_000;

/** The line that keeps a Cell's `.cell/` directory out of every worktree's status (PROTOCOL §4). */
export const CELL_EXCLUDE_LINE = '.cell/';

/** The bare mirror of a repo: one per repo URL, under the Cell's data directory. */
export const mirrorPathOf = (cellDataDir: string, url: string): string =>
  join(
    cellDataDir,
    'mirrors',
    `${createHash('sha256').update(url).digest('hex').slice(0, 16)}.git`,
  );

/** Adds `.cell/` to the mirror's `info/exclude` once. Worktrees of the mirror read that file too. */
export const excludeCellDir = (mirrorPath: string): void => {
  const file = join(mirrorPath, 'info', 'exclude');
  mkdirSync(dirname(file), { recursive: true });
  const current = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const lines = current.split('\n');
  if (lines.includes(CELL_EXCLUDE_LINE)) return;
  const separator = current === '' || current.endsWith('\n') ? '' : '\n';
  writeFileSync(file, `${current}${separator}${CELL_EXCLUDE_LINE}\n`);
};

export type MirrorResult =
  | { ok: true; path: string }
  | { ok: false; detail: string; output: Uint8Array };

/**
 * Makes the bare mirror of `url` current: a `git clone --mirror` the first time, then a fetch that
 * prunes what the remote deleted. The mirror is what worktrees are made from, so the Cell never clones
 * a repo twice.
 */
export const ensureMirror = async (
  ctx: ShellContext,
  input: { cellDataDir: string; url: string },
): Promise<MirrorResult> => {
  const path = mirrorPathOf(input.cellDataDir, input.url);
  const cwd = input.cellDataDir;
  mkdirSync(cwd, { recursive: true });
  const command = existsSync(join(path, 'HEAD'))
    ? gitCommand(['-C', path, 'fetch', '--prune', 'origin'])
    : gitCommand(['clone', '--mirror', '--', input.url, path]);
  const run = await runShell(ctx, { command, cwd, timeoutMs: GIT_TIMEOUT_MS });
  if (!succeeded(run)) {
    return {
      ok: false,
      detail: describeFailure(run, GIT_TIMEOUT_MS),
      output: run.output,
    };
  }
  excludeCellDir(path);
  return { ok: true, path };
};
