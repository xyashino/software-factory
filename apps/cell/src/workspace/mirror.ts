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
} from './shell';

/** Git operations on the mirror may take this long; a repo fetch is the slow one. */
export const GIT_TIMEOUT_MS = 120_000;

/** The line that keeps a Cell's `.cell/` directory out of every worktree's status (PROTOCOL §4). */
export const CELL_EXCLUDE_LINE = '.cell/';

/** A full commit SHA, the only base a fetch may be skipped for. */
const COMMIT = /^[0-9a-f]{40}$/;

/** The mirror operations in flight, by mirror path: the next one for a path waits for the one before. */
const mirrorTurns = new Map<string, Promise<unknown>>();

/**
 * Runs `work` after the mirror operations queued before it for the same mirror path. Every operation
 * that touches a mirror or its worktree records (clone, fetch, worktree add, prune, remove) goes through
 * here, so two Jobs of one Cell never interleave git writes on one mirror.
 */
export const withMirrorLock = <T>(
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

/** Whether the mirror already holds `commit` as a commit object. */
const mirrorHas = async (
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
 * Makes the bare mirror of `url` current: a `git clone --mirror` the first time, then a fetch that
 * prunes what the remote deleted. The mirror is what worktrees are made from, so the Cell never clones
 * a repo twice.
 *
 * `commit` names a pinned base. When the mirror already holds that commit, the remote fetch is skipped:
 * a pinned base does not move, so the fetch would only tell the Cell what it has. Callers that need the
 * remote's current refs (plan jobs, deliver) pass no `commit` and always fetch.
 */
export const ensureMirror = async (
  ctx: ShellContext,
  input: { cellDataDir: string; url: string; commit?: string },
): Promise<MirrorResult> => {
  const path = mirrorPathOf(input.cellDataDir, input.url);
  const cwd = input.cellDataDir;
  mkdirSync(cwd, { recursive: true });
  return withMirrorLock(path, async () => {
    const exists = existsSync(join(path, 'HEAD'));
    const pinned = input.commit !== undefined && COMMIT.test(input.commit);
    const skipFetch =
      exists && pinned && (await mirrorHas(ctx, path, input.commit!));
    if (!skipFetch) {
      // A first clone goes to a temporary name and is renamed into place, so a Cell killed mid-clone
      // leaves no half mirror at the real path.
      const target = exists
        ? path
        : `${path}.partial-${process.pid}-${Date.now()}`;
      const command = exists
        ? gitCommand(['-C', path, 'fetch', '--prune', 'origin'])
        : gitCommand(['clone', '--mirror', '--', input.url, target]);
      const run = await runShell(ctx, {
        command,
        cwd,
        timeoutMs: GIT_TIMEOUT_MS,
      });
      if (!succeeded(run)) {
        if (!exists) rmSync(target, { recursive: true, force: true });
        return {
          ok: false as const,
          detail: describeFailure(run, GIT_TIMEOUT_MS),
          output: run.output,
        };
      }
      if (!exists) renameSync(target, path);
    }
    // Checkpoints push explicit refspecs to origin, which a mirror remote refuses. The fetch mapping stays
    // the mirror's own, so refs read by plan and deliver are unchanged.
    const unmirrored = await runShell(ctx, {
      command: gitCommand([
        '-C',
        path,
        'config',
        'remote.origin.mirror',
        'false',
      ]),
      cwd,
      timeoutMs: GIT_TIMEOUT_MS,
    });
    if (!succeeded(unmirrored)) {
      return {
        ok: false as const,
        detail: describeFailure(unmirrored, GIT_TIMEOUT_MS),
        output: unmirrored.output,
      };
    }
    excludeCellDir(path);
    return { ok: true as const, path };
  });
};
