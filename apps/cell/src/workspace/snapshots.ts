import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RunGit, GitResult } from '../ports';
import {
  preservedRefFor,
  snapshotNamespaceOf,
  stationSnapshotNamespaceOf,
} from '../names';

const NAMESPACE = 'refs/software-factory/';
// `.cell/` is the Cell's scratch: it is never part of a snapshot.
const CELL_EXCLUDE = [':(exclude).cell'] as const;

const must = (result: GitResult, what: string): string => {
  if (result.code !== 0) {
    throw new Error(
      `${what} failed: ${result.stderr.trim() || `exit ${result.code}`}`,
    );
  }
  return result.stdout;
};

const requireNamespace = (ref: string): void => {
  if (!ref.startsWith(NAMESPACE)) {
    throw new Error(`snapshot ref must start with ${NAMESPACE}`);
  }
};

// Runs `use` with the tree of the worktree as it stands, read through a temporary index file. The index is
// seeded from HEAD, so the tree differs from HEAD only by the worktree's changes. `head` is undefined on an
// unborn branch.
const withWorktreeTree = async <T>(
  git: RunGit,
  worktree: string,
  use: (tree: string, head: string | undefined) => Promise<T>,
): Promise<T> => {
  const indexDir = mkdtempSync(join(tmpdir(), 'sf-index-'));
  const env = { GIT_INDEX_FILE: join(indexDir, 'index') };
  try {
    const head = await git(worktree, [
      'rev-parse',
      '--verify',
      '--quiet',
      'HEAD',
    ]);
    if (head.code === 0) {
      must(await git(worktree, ['read-tree', 'HEAD'], env), 'read-tree HEAD');
    }
    // Ignored files stay out (`.cell/` is git-excluded by the Cell); a `:(exclude)` pathspec would make git refuse
    // an ignored path, so `.cell/` is dropped from the temporary index instead, whether or not it is ignored.
    must(await git(worktree, ['add', '-A', '--', '.'], env), 'add -A');
    must(
      await git(
        worktree,
        ['rm', '-r', '-q', '--cached', '--ignore-unmatch', '--', '.cell'],
        env,
      ),
      'rm --cached .cell',
    );
    const tree = must(
      await git(worktree, ['write-tree'], env),
      'write-tree',
    ).trim();
    return await use(tree, head.code === 0 ? head.stdout.trim() : undefined);
  } finally {
    rmSync(indexDir, { recursive: true, force: true });
  }
};

/**
 * Records the worktree's state under `ref` before a Cycle changes anything. The snapshot commit's parent is the
 * HEAD it was taken on, so a later restore can tell whether a commit has landed since. Returns the commit.
 */
export const snapshot = async (input: {
  git: RunGit;
  worktree: string;
  ref: string;
}): Promise<string> => {
  const { git, worktree, ref } = input;
  requireNamespace(ref);
  return withWorktreeTree(git, worktree, async (tree, head) => {
    const parents = head === undefined ? [] : ['-p', head];
    const commit = must(
      await git(worktree, [
        'commit-tree',
        tree,
        ...parents,
        '-m',
        `snapshot ${ref}`,
      ]),
      'commit-tree',
    ).trim();
    must(await git(worktree, ['update-ref', ref, commit]), `update-ref ${ref}`);
    return commit;
  });
};

/**
 * Whether the worktree differs from the snapshot under `ref`, by exact tree equality. Fails closed: a snapshot
 * that cannot be read, or a worktree that cannot be captured, counts as changed.
 */
export const differsFromSnapshot = async (input: {
  git: RunGit;
  worktree: string;
  ref: string;
}): Promise<boolean> => {
  const { git, worktree, ref } = input;
  try {
    const snapshotTree = must(
      await git(worktree, ['rev-parse', '--verify', `${ref}^{tree}`]),
      `rev-parse ${ref}`,
    ).trim();
    return await withWorktreeTree(
      git,
      worktree,
      async (tree) => tree !== snapshotTree,
    );
  } catch {
    return true;
  }
};

/**
 * Rolls the worktree back to the snapshot under `ref`: its tree replaces the index and the files, and untracked
 * files made since are removed. Ignored files (`node_modules`, `.cell/`) survive. HEAD and the branch do not move.
 */
export const restore = async (input: {
  git: RunGit;
  worktree: string;
  ref: string;
}): Promise<void> => {
  const { git, worktree, ref } = input;
  const commit = must(
    await git(worktree, ['rev-parse', '--verify', `${ref}^{commit}`]),
    `rev-parse ${ref}`,
  ).trim();
  must(
    await git(worktree, ['read-tree', '-u', '--reset', commit]),
    'read-tree --reset',
  );
  must(
    await git(worktree, ['clean', '-fd', '--', '.', ...CELL_EXCLUDE]),
    'clean -fd',
  );
};

/**
 * Rolls the worktree back to the newest snapshot of a station, when that is still the state the Cycle started
 * from: the snapshot's parent must be the current HEAD (no commit has landed since). Returns the ref restored,
 * or undefined when there is nothing safe to restore. A restart uses this to rerun a crashed write Cycle clean.
 */
/**
 * Whether a write Cycle's rerun rolls the worktree back to its pre-cycle snapshot. Only a rerun that takes over a
 * Cycle which did not finish does: a restart (the Cycle crashed or timed out) or a resume. A retry after a verdict
 * or a gate failure follows a Cycle that completed, so its uncommitted work is what the next Station builds on.
 */
export const rollsBackBeforeRerun = (cause: {
  kind: 'first' | 'retry' | 'restart' | 'handover' | 'resume';
}): boolean => cause.kind === 'restart' || cause.kind === 'resume';

export const restoreStationSnapshot = async (input: {
  git: RunGit;
  worktree: string;
  todoId: string;
  stationId: string;
  /** The Cycle that is about to rerun: its uncommitted work is preserved under its own ref first. */
  cycleId: string;
}): Promise<string | undefined> => {
  const { git, worktree, todoId, stationId, cycleId } = input;
  const listed = must(
    await git(worktree, [
      'for-each-ref',
      '--sort=refname',
      '--format=%(refname)',
      stationSnapshotNamespaceOf(todoId, stationId),
    ]),
    'for-each-ref',
  );
  const refs = listed.split('\n').filter((line) => line.length > 0);
  const ref = refs[refs.length - 1];
  if (ref === undefined) return undefined;

  const parent = await git(worktree, [
    'rev-parse',
    '--verify',
    '--quiet',
    `${ref}^`,
  ]);
  const head = await git(worktree, [
    'rev-parse',
    '--verify',
    '--quiet',
    'HEAD',
  ]);
  if (parent.code !== 0 || head.code !== 0) return undefined;
  if (parent.stdout.trim() !== head.stdout.trim()) return undefined;

  // Whatever is in the worktree now is kept under its own ref before the rollback discards it.
  await snapshot({
    git,
    worktree,
    ref: preservedRefFor(todoId, cycleId),
  });
  await restore({ git, worktree, ref });
  return ref;
};

/**
 * Deletes every snapshot ref of a Work order, after its delivery (or cancellation). Refs of other Work orders
 * are not touched. Returns how many refs were removed.
 */
export const deleteSnapshotRefs = async (input: {
  git: RunGit;
  worktree: string;
  todoId: string;
}): Promise<number> => {
  const { git, worktree, todoId } = input;
  const listed = must(
    await git(worktree, [
      'for-each-ref',
      '--format=%(refname)',
      snapshotNamespaceOf(todoId),
    ]),
    'for-each-ref',
  );
  const refs = listed.split('\n').filter((line) => line.length > 0);
  for (const ref of refs) {
    must(
      await git(worktree, ['update-ref', '-d', ref]),
      `update-ref -d ${ref}`,
    );
  }
  return refs.length;
};
