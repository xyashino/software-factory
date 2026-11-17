import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runGit } from '../git';
import { preservedRefFor, snapshotRefFor } from '../names';
import {
  restoreStationSnapshot,
  rollsBackBeforeRerun,
  snapshot,
} from '../workspace/snapshots';
import { scratch } from './helpers/git';

const TODO = 'todos-import-export';
const STATION = 'build';
const CYCLE = '01M7M94WJP3SEQFFV4S7PAEXCG';
const RETRY_CYCLE = '01M7MBYTPPMP81GJTZPYPC87MH';

const must = async (cwd: string, args: string[]): Promise<string> => {
  const result = await runGit(cwd, args);
  if (result.code !== 0)
    throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
};

/** A repo with one committed file, on a branch, as a Cell's worktree is. */
const makeWorktree = async (): Promise<string> => {
  const dir = scratch('rollback');
  await must(dir, ['init', '--quiet', '-b', 'factory/todo']);
  writeFileSync(join(dir, 'README.md'), '# base\n');
  await must(dir, ['add', '.']);
  await must(dir, [
    '-c',
    'user.name=t',
    '-c',
    'user.email=t@example.test',
    'commit',
    '--quiet',
    '-m',
    'base',
  ]);
  return dir;
};

describe('rollsBackBeforeRerun', () => {
  it('rolls back only a rerun that takes over a Cycle which did not finish', () => {
    expect(rollsBackBeforeRerun({ kind: 'restart' })).toBe(true);
    expect(rollsBackBeforeRerun({ kind: 'resume' })).toBe(true);
    expect(rollsBackBeforeRerun({ kind: 'retry' })).toBe(false);
    expect(rollsBackBeforeRerun({ kind: 'handover' })).toBe(false);
    expect(rollsBackBeforeRerun({ kind: 'first' })).toBe(false);
  });
});

describe('restoreStationSnapshot keeps the work it discards', () => {
  it('preserves uncommitted work under its own ref before a restart rolls back', async () => {
    const worktree = await makeWorktree();
    // The pre-cycle snapshot of the build Cycle: the clean base.
    await snapshot({
      git: runGit,
      worktree,
      ref: snapshotRefFor(TODO, STATION, CYCLE),
    });
    // The Cycle then wrote work it never committed, and crashed.
    writeFileSync(join(worktree, 'feature.ts'), 'export const work = 1;\n');
    writeFileSync(join(worktree, 'README.md'), '# changed\n');

    const restored = await restoreStationSnapshot({
      git: runGit,
      worktree,
      todoId: TODO,
      stationId: STATION,
      cycleId: RETRY_CYCLE,
    });

    expect(restored).toBe(snapshotRefFor(TODO, STATION, CYCLE));
    expect(existsSync(join(worktree, 'feature.ts'))).toBe(false);
    expect(readFileSync(join(worktree, 'README.md'), 'utf8')).toBe('# base\n');

    // The discarded work is still in the repository, under the preserved ref.
    const preserved = preservedRefFor(TODO, RETRY_CYCLE);
    const tree = await must(worktree, [
      'ls-tree',
      '-r',
      '--name-only',
      preserved,
    ]);
    expect(tree.split('\n')).toContain('feature.ts');
    const kept = await must(worktree, ['show', `${preserved}:feature.ts`]);
    expect(kept).toBe('export const work = 1;');
  });

  it('leaves the worktree alone and writes no preserved ref when HEAD has moved since the snapshot', async () => {
    const worktree = await makeWorktree();
    await snapshot({
      git: runGit,
      worktree,
      ref: snapshotRefFor(TODO, STATION, CYCLE),
    });
    writeFileSync(join(worktree, 'note.txt'), 'kept\n');
    await must(worktree, ['add', 'note.txt']);
    await must(worktree, [
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@example.test',
      'commit',
      '--quiet',
      '-m',
      'landed',
    ]);

    const restored = await restoreStationSnapshot({
      git: runGit,
      worktree,
      todoId: TODO,
      stationId: STATION,
      cycleId: RETRY_CYCLE,
    });

    expect(restored).toBeUndefined();
    expect(readFileSync(join(worktree, 'note.txt'), 'utf8')).toBe('kept\n');
    const refs = await must(worktree, [
      'for-each-ref',
      '--format=%(refname)',
      preservedRefFor(TODO, RETRY_CYCLE),
    ]);
    expect(refs).toBe('');
  });
});
