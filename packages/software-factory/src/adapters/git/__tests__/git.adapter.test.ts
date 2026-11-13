import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { createGitAdapter } from '../git.adapter';

const sh = (cwd: string, args: string[]): string => {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@localhost',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@localhost',
    },
  }).trim();
};

let repo: string;
let origin: string;

/** A repo whose origin/main is a local bare remote, with one committed file. */
beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), 'sf-git-'));
  origin = join(root, 'origin.git');
  repo = join(root, 'repo');
  sh(root, ['init', '--bare', '--initial-branch=main', origin]);
  sh(root, ['init', '--initial-branch=main', repo]);
  writeFileSync(join(repo, 'tracked.txt'), 'v1\n');
  writeFileSync(join(repo, '.gitignore'), 'node_modules/\n.worktrees/\n');
  sh(repo, ['add', '-A']);
  sh(repo, ['commit', '-m', 'init']);
  sh(repo, ['remote', 'add', 'origin', origin]);
  sh(repo, ['push', '-u', 'origin', 'main']);
});

describe('git adapter worktrees', () => {
  it('creates a task worktree on a new branch off origin/main', async () => {
    const git = createGitAdapter(repo);
    const path = join(repo, '.worktrees', 'task-1');
    await git.createWorktree({
      path,
      branch: 'factory/task-1',
      base: 'origin/main',
    });
    expect(existsSync(join(path, 'tracked.txt'))).toBe(true);
    expect(sh(path, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe(
      'factory/task-1',
    );
    await git.removeWorktree(path);
    expect(existsSync(path)).toBe(false);
  });

  it('checks out a branch that only origin has', async () => {
    const git = createGitAdapter(repo);
    const first = join(repo, '.worktrees', 'task-2');
    await git.createWorktree({
      path: first,
      branch: 'factory/task-2',
      base: 'origin/main',
    });
    writeFileSync(join(first, 'feature.txt'), 'done\n');
    sh(first, ['add', '-A']);
    sh(first, ['commit', '-m', 'feat(task): add feature']);
    sh(first, ['push', '-u', 'origin', 'factory/task-2']);
    await git.removeWorktree(first);
    sh(repo, ['branch', '-D', 'factory/task-2']);

    const review = join(repo, '.worktrees', 'task-2-again');
    await git.createWorktree({
      path: review,
      branch: 'factory/task-2',
      base: 'origin/main',
    });
    expect(existsSync(join(review, 'feature.txt'))).toBe(true);
    expect(sh(review, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe(
      'factory/task-2',
    );
    await git.removeWorktree(review);
  });
});

describe('git adapter snapshots', () => {
  it('restores tracked and untracked files but keeps ignored dependencies', async () => {
    const git = createGitAdapter(repo);
    const path = join(repo, '.worktrees', 'task-2');
    await git.createWorktree({
      path,
      branch: 'factory/task-2',
      base: 'origin/main',
    });
    const ref = 'refs/software-factory/task-2/build/att-1';
    const head = sh(path, ['rev-parse', 'HEAD']);

    writeFileSync(join(path, 'tracked.txt'), 'changed before snapshot\n');
    const commit = await git.snapshot({ worktree: path, ref });
    expect(sh(repo, ['rev-parse', ref])).toBe(commit);
    expect(sh(path, ['rev-parse', 'HEAD'])).toBe(head);

    writeFileSync(join(path, 'tracked.txt'), 'broken by agent\n');
    writeFileSync(join(path, 'stray.txt'), 'untracked\n');
    writeFileSync(join(path, 'node_modules.marker'), 'x');
    execFileSync('mkdir', ['-p', join(path, 'node_modules')]);
    writeFileSync(join(path, 'node_modules', 'dep.js'), 'dep');

    await git.restore({ worktree: path, ref });
    expect(readFileSync(join(path, 'tracked.txt'), 'utf8')).toBe(
      'changed before snapshot\n',
    );
    expect(existsSync(join(path, 'stray.txt'))).toBe(false);
    expect(existsSync(join(path, 'node_modules', 'dep.js'))).toBe(true);
    expect(sh(path, ['rev-parse', 'HEAD'])).toBe(head);
    await git.removeWorktree(path);
  });

  it('tells whether the worktree differs from a snapshot, ignoring dependencies', async () => {
    const git = createGitAdapter(repo);
    const path = join(repo, '.worktrees', 'task-3');
    await git.createWorktree({
      path,
      branch: 'factory/task-3',
      base: 'origin/main',
    });
    const ref = 'refs/software-factory/task-3/operator/att-1';
    await git.snapshot({ worktree: path, ref });

    execFileSync('mkdir', ['-p', join(path, 'node_modules')]);
    writeFileSync(join(path, 'node_modules', 'dep.js'), 'dep');
    expect(await git.differsFromSnapshot({ worktree: path, ref })).toBe(false);

    writeFileSync(join(path, 'stray.txt'), 'untracked\n');
    expect(await git.differsFromSnapshot({ worktree: path, ref })).toBe(true);
    await git.removeWorktree(path);
  });

  it('refuses refs outside the software-factory namespace', async () => {
    const git = createGitAdapter(repo);
    await expect(
      git.snapshot({ worktree: repo, ref: 'refs/heads/oops' }),
    ).rejects.toThrow('refs/software-factory/');
  });
});

describe('git adapter changes and delivery', () => {
  it('removes a tracked file so the deletion is uncommitted, and ignores a missing one', async () => {
    const git = createGitAdapter(repo);
    await git.removeFile({ worktree: repo, path: 'tracked.txt' });
    expect(existsSync(join(repo, 'tracked.txt'))).toBe(false);
    expect(await git.uncommittedFiles(repo)).toContain('tracked.txt');
    await expect(
      git.removeFile({ worktree: repo, path: 'absent.txt' }),
    ).resolves.toBeUndefined();
  });

  it('detects changes, commits, pushes and sees the remote branch', async () => {
    const git = createGitAdapter(repo);
    const path = join(repo, '.worktrees', 'task-3');
    await git.createWorktree({
      path,
      branch: 'factory/task-3',
      base: 'origin/main',
    });

    expect(await git.hasChanges({ worktree: path, base: 'origin/main' })).toBe(
      false,
    );
    expect(await git.remoteBranchExists('factory/task-3')).toBe(false);

    writeFileSync(join(path, 'new.txt'), 'hello\n');
    expect(await git.hasChanges({ worktree: path, base: 'origin/main' })).toBe(
      true,
    );

    const sha = await git.commitAll({
      worktree: path,
      message: 'feat: add new',
    });
    expect(sha).toBe(sh(path, ['rev-parse', 'HEAD']));
    expect(await git.hasChanges({ worktree: path, base: 'origin/main' })).toBe(
      true,
    );

    await git.push({ worktree: path, branch: 'factory/task-3' });
    expect(await git.remoteBranchExists('factory/task-3')).toBe(true);
    await git.removeWorktree(path);
  });
});
