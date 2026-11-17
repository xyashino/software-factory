import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runGit } from '../git';
import { snapshotRefFor } from '../names';
import { git, makeRepo, writeIn } from '../testing/git-repo';
import {
  deleteSnapshotRefs,
  differsFromSnapshot,
  restore,
  restoreStationSnapshot,
  snapshot,
} from '../workspace/snapshots';

const TODO = 'todo-1';
const CYCLE = '01J0000000000000000000000C';
const REF = snapshotRefFor(TODO, 'build', CYCLE);

let root: string;
let worktree: string;
let headBefore: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'factory-cell-snapshots-'));
  worktree = join(root, 'worktree');
  makeRepo(worktree, {
    'README.md': '# repo\n',
    'src/app.ts': 'export {};\n',
    '.gitignore': 'ignored.log\n',
  });
  git(worktree, 'checkout', '-b', `factory/${TODO}`);
  headBefore = git(worktree, 'rev-parse', 'HEAD');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const take = (ref = REF) => snapshot({ git: runGit, worktree, ref });
const differs = (ref = REF) =>
  differsFromSnapshot({ git: runGit, worktree, ref });

describe('snapshot (a pre-cycle record of the worktree)', () => {
  it('records the dirty tree under its ref without moving HEAD or the branch', async () => {
    writeIn(worktree, 'src/app.ts', 'export const app = 1;\n');
    writeIn(worktree, 'new.txt', 'built\n');

    await take();

    expect(git(worktree, 'rev-parse', REF)).toBeTruthy();
    expect(git(worktree, 'rev-parse', 'HEAD')).toBe(headBefore);
    expect(git(worktree, 'symbolic-ref', '--short', 'HEAD')).toBe(
      `factory/${TODO}`,
    );
  });

  it('leaves the worktree index as it was', async () => {
    writeIn(worktree, 'new.txt', 'built\n');
    const statusBefore = git(worktree, 'status', '--porcelain');

    await take();

    expect(git(worktree, 'status', '--porcelain')).toBe(statusBefore);
  });

  it('keeps the .cell/ scratch out of the snapshot', async () => {
    writeIn(worktree, '.cell/worktree.json', '{}\n');
    writeIn(worktree, 'new.txt', 'built\n');

    await take();

    const files = git(worktree, 'ls-tree', '-r', '--name-only', REF).split(
      '\n',
    );
    expect(files).toContain('new.txt');
    expect(files.some((file) => file.startsWith('.cell/'))).toBe(false);
  });

  it('refuses a ref outside the snapshot namespace', async () => {
    await expect(take('refs/heads/elsewhere')).rejects.toThrow(
      /must start with refs\/software-factory\//,
    );
  });
});

describe('differsFromSnapshot (the exact read-only check)', () => {
  it('reports no change on an unchanged dirty tree', async () => {
    writeIn(worktree, 'src/app.ts', 'export const app = 1;\n');
    writeIn(worktree, 'new.txt', 'built\n');
    await take();

    expect(await differs()).toBe(false);
  });

  it('reports a change when a modified file is modified again', async () => {
    writeIn(worktree, 'src/app.ts', 'export const app = 1;\n');
    await take();

    writeIn(worktree, 'src/app.ts', 'export const app = 2;\n');

    expect(await differs()).toBe(true);
  });

  it('reports a change when an untracked file is rewritten under the same name', async () => {
    writeIn(worktree, 'new.txt', 'built\n');
    await take();

    writeIn(worktree, 'new.txt', 'built twice\n');

    expect(await differs()).toBe(true);
  });

  it('reports a change when a new file appears', async () => {
    await take();

    writeIn(worktree, 'added.txt', 'x\n');

    expect(await differs()).toBe(true);
  });

  it('ignores writes into .cell/', async () => {
    await take();

    writeIn(worktree, '.cell/cycles/prompt.md', 'hello\n');

    expect(await differs()).toBe(false);
  });

  it('reports a change when the snapshot ref does not exist', async () => {
    const missing = snapshotRefFor(TODO, 'build', '01J0000000000000000000000Z');

    expect(await differs(missing)).toBe(true);
  });
});

describe('restore (roll back to a snapshot)', () => {
  it('brings back edited and deleted files and removes the files made since', async () => {
    writeIn(worktree, 'src/app.ts', 'export const app = 1;\n');
    writeIn(worktree, 'kept.txt', 'kept\n');
    await take();

    writeIn(worktree, 'src/app.ts', 'export const app = 9;\n');
    rmSync(join(worktree, 'kept.txt'));
    writeIn(worktree, 'stray.txt', 'stray\n');

    await restore({ git: runGit, worktree, ref: REF });

    expect(readFileSync(join(worktree, 'src/app.ts'), 'utf8')).toBe(
      'export const app = 1;\n',
    );
    expect(readFileSync(join(worktree, 'kept.txt'), 'utf8')).toBe('kept\n');
    expect(existsSync(join(worktree, 'stray.txt'))).toBe(false);
  });

  it('keeps ignored files and the .cell/ scratch', async () => {
    await take();
    writeIn(worktree, 'ignored.log', 'build cache\n');
    writeIn(worktree, '.cell/worktree.json', '{}\n');

    await restore({ git: runGit, worktree, ref: REF });

    expect(readFileSync(join(worktree, 'ignored.log'), 'utf8')).toBe(
      'build cache\n',
    );
    expect(readFileSync(join(worktree, '.cell/worktree.json'), 'utf8')).toBe(
      '{}\n',
    );
  });

  it('leaves HEAD and the branch where they were', async () => {
    await take();
    writeIn(worktree, 'stray.txt', 'stray\n');

    await restore({ git: runGit, worktree, ref: REF });

    expect(git(worktree, 'rev-parse', 'HEAD')).toBe(headBefore);
    expect(git(worktree, 'symbolic-ref', '--short', 'HEAD')).toBe(
      `factory/${TODO}`,
    );
  });
});

describe('restoreStationSnapshot (a restart rolls back its own station)', () => {
  it('restores the newest snapshot of the station when no commit has landed since', async () => {
    writeIn(worktree, 'src/app.ts', 'export const app = 1;\n');
    await take(snapshotRefFor(TODO, 'build', '01J0000000000000000000000A'));
    writeIn(worktree, 'src/app.ts', 'export const app = 2;\n');
    await take(snapshotRefFor(TODO, 'build', '01J0000000000000000000000B'));
    writeIn(worktree, 'src/app.ts', 'export const app = 3;\n');

    const restored = await restoreStationSnapshot({
      git: runGit,
      worktree,
      todoId: TODO,
      stationId: 'build',
      cycleId: CYCLE,
    });

    expect(restored).toBe(
      snapshotRefFor(TODO, 'build', '01J0000000000000000000000B'),
    );
    expect(readFileSync(join(worktree, 'src/app.ts'), 'utf8')).toBe(
      'export const app = 2;\n',
    );
  });

  it('restores nothing when a commit has landed since the snapshot', async () => {
    writeIn(worktree, 'src/app.ts', 'export const app = 1;\n');
    await take();
    writeIn(worktree, 'src/app.ts', 'export const app = 2;\n');
    git(worktree, 'commit', '-am', 'checkpoint');
    writeIn(worktree, 'src/app.ts', 'export const app = 3;\n');

    const restored = await restoreStationSnapshot({
      git: runGit,
      worktree,
      todoId: TODO,
      stationId: 'build',
      cycleId: CYCLE,
    });

    expect(restored).toBeUndefined();
    expect(readFileSync(join(worktree, 'src/app.ts'), 'utf8')).toBe(
      'export const app = 3;\n',
    );
  });

  it('restores nothing when the station has no snapshot', async () => {
    const restored = await restoreStationSnapshot({
      git: runGit,
      worktree,
      todoId: TODO,
      stationId: 'build',
      cycleId: CYCLE,
    });

    expect(restored).toBeUndefined();
  });
});

describe('deleteSnapshotRefs (after delivery)', () => {
  it('removes the snapshot refs of the Work order and keeps the others', async () => {
    await take(snapshotRefFor(TODO, 'build', CYCLE));
    await take(snapshotRefFor('todo-2', 'build', CYCLE));

    const removed = await deleteSnapshotRefs({
      git: runGit,
      worktree,
      todoId: TODO,
    });

    expect(removed).toBe(1);
    expect(
      git(
        worktree,
        'for-each-ref',
        '--format=%(refname)',
        'refs/software-factory/',
      ),
    ).toBe(snapshotRefFor('todo-2', 'build', CYCLE));
  });

  it('removes nothing when the Work order has no snapshot', async () => {
    const removed = await deleteSnapshotRefs({
      git: runGit,
      worktree,
      todoId: TODO,
    });

    expect(removed).toBe(0);
  });
});
