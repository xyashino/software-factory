import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import {
  describeFailure,
  gitCommand,
  runShell,
  succeeded,
  type ShellContext,
  type ShellRun,
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

/** The mirror operations in flight, by mirror path: the next one for a path waits for the one before. */
const mirrorTurns = new Map<string, Promise<unknown>>();

/**
 * Runs `work` after the mirror operations queued before it for the same mirror path. A Cell runs one Job
 * at a time, but a continuation and a stopping Job may overlap, and both touch the same mirror and worktree.
 */
export const withMirrorLock = <T>(
  mirrorPath: string,
  work: () => Promise<T>,
): Promise<T> => {
  const previous = mirrorTurns.get(mirrorPath) ?? Promise.resolve();
  const turn = previous.then(work);
  mirrorTurns.set(
    mirrorPath,
    turn.catch(() => undefined),
  );
  return turn;
};

export type MirrorResult =
  | { ok: true; path: string }
  | { ok: false; detail: string; output: Uint8Array };

/**
 * Clears the mirror flag of the `origin` remote. A `--mirror` remote refuses the explicit refspecs the
 * checkpoints push with (`commit:refs/heads/<branch>`). The fetch mapping stays `+refs/*:refs/*`, so
 * `refs/heads` still holds the remote's branches for the readers of the mirror.
 */
const allowExplicitPush = (
  ctx: ShellContext,
  path: string,
): Promise<ShellRun> =>
  runShell(ctx, {
    command: gitCommand([
      '-C',
      path,
      'config',
      'remote.origin.mirror',
      'false',
    ]),
    cwd: path,
    timeoutMs: GIT_TIMEOUT_MS,
  });

/** Whether the mirror already holds `commit` as a commit object. */
const hasCommit = async (
  ctx: ShellContext,
  mirror: string,
  commit: string,
): Promise<boolean> => {
  const run = await runShell(ctx, {
    command: gitCommand(['-C', mirror, 'cat-file', '-e', `${commit}^{commit}`]),
    cwd: mirror,
    timeoutMs: GIT_TIMEOUT_MS,
  });
  return succeeded(run);
};

/**
 * Makes the bare mirror of `url` current, without taking the mirror lock: the caller holds it. A
 * `git clone --mirror` the first time (under a temporary name, renamed into place, so a Cell killed
 * mid-clone leaves no half mirror), then a fetch that prunes what the remote deleted. A `pinned` commit
 * that the mirror already holds skips that fetch: a pinned base needs no new refs.
 */
export const fetchMirror = async (
  ctx: ShellContext,
  input: { cellDataDir: string; url: string; pinned?: string },
): Promise<MirrorResult> => {
  const path = mirrorPathOf(input.cellDataDir, input.url);
  const cwd = input.cellDataDir;
  mkdirSync(cwd, { recursive: true });
  const fail = (run: ShellRun): MirrorResult => ({
    ok: false,
    detail: describeFailure(run, GIT_TIMEOUT_MS),
    output: run.output,
  });

  if (existsSync(join(path, 'HEAD'))) {
    const allowed = await allowExplicitPush(ctx, path);
    if (!succeeded(allowed)) return fail(allowed);
    if (
      input.pinned !== undefined &&
      (await hasCommit(ctx, path, input.pinned))
    ) {
      excludeCellDir(path);
      return { ok: true, path };
    }
    const pulled = await runShell(ctx, {
      command: gitCommand(['-C', path, 'fetch', '--prune', 'origin']),
      cwd,
      timeoutMs: GIT_TIMEOUT_MS,
    });
    if (!succeeded(pulled)) return fail(pulled);
  } else {
    const partial = `${path}.partial-${process.pid}-${Date.now()}`;
    const cloned = await runShell(ctx, {
      command: gitCommand(['clone', '--mirror', '--', input.url, partial]),
      cwd,
      timeoutMs: GIT_TIMEOUT_MS,
    });
    const allowed = succeeded(cloned)
      ? await allowExplicitPush(ctx, partial)
      : cloned;
    if (!succeeded(allowed)) {
      rmSync(partial, { recursive: true, force: true });
      return fail(allowed);
    }
    renameSync(partial, path);
  }
  excludeCellDir(path);
  return { ok: true, path };
};

/**
 * Makes the bare mirror of `url` current under the mirror lock. See `fetchMirror`; callers that also
 * touch the mirror's worktrees take the lock themselves and call `fetchMirror` inside it.
 */
export const ensureMirror = (
  ctx: ShellContext,
  input: { cellDataDir: string; url: string },
): Promise<MirrorResult> =>
  withMirrorLock(mirrorPathOf(input.cellDataDir, input.url), () =>
    fetchMirror(ctx, input),
  );
