import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Job } from '@repo/factory-core/contracts/job';
import { createSystemAdapter } from '../adapters/system/system.adapter';
import { prepareWorkspace, type PrepareContext } from '../workspace/prepare';
import { tryLockWorktree } from '../workspace/repo-lock';
import { worktreesRootOf } from '../workspace/repo';
import { shellQuote } from '../workspace/shell';
import { worktreePathOf } from '../workspace/worktree';
import { cloneRepo, commitFile, git, makeRepo } from '../testing/git-repo';

let root: string;
let origin: string;
let repoRoot: string;
let cellDataDir: string;
let counter: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'factory-cell-workspace-'));
  origin = join(root, 'origin');
  repoRoot = join(root, 'repo');
  cellDataDir = join(root, 'cell');
  counter = join(root, 'setup-count.txt');
  makeRepo(origin);
  cloneRepo(origin, repoRoot);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** The prepare context a job runs with: real system, logs in the Cell's directory. */
const contextWith = (
  overrides: Partial<PrepareContext> = {},
): PrepareContext => ({
  shell: {
    system: createSystemAdapter(),
    logDir: join(cellDataDir, 'logs', 'test'),
  },
  repoRoot,
  worktreeLimit: 8,
  inUse: new Set(),
  ...overrides,
});

/** A job with only the fields the workspace reads. */
const jobWith = (dir: string, setup: string[] = [], sync: string[] = []): Job =>
  ({
    jobId: '01J0000000000000000000000J',
    repo: { url: origin, baseBranch: 'main', branch: `factory/${dir}` },
    base: { branchBase: 'main' },
    workspace: { dir, sync, setup, timeoutMs: 60_000 },
  }) as unknown as Job;

/** The command that appends one line to the counter file: how many times setup ran. */
const countSetup = (): string => `echo run >> ${shellQuote(counter)}`;
const setupRuns = (): number =>
  existsSync(counter)
    ? readFileSync(counter, 'utf8').split('\n').filter(Boolean).length
    : 0;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

describe('workspace worktrees', () => {
  it('creates a detached worktree under the repo and lists it in git worktree list', async () => {
    const head = git(origin, 'rev-parse', 'HEAD');

    const prepared = await prepareWorkspace(contextWith(), jobWith('todo-1'));

    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.worktree).toBe(join(repoRoot, '.worktrees', 'todo-1'));
    expect(prepared.head).toBe(head);
    expect(git(prepared.worktree, 'rev-parse', 'HEAD')).toBe(head);
    expect(git(prepared.worktree, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(
      'HEAD',
    );
    expect(git(repoRoot, 'worktree', 'list', '--porcelain')).toContain(
      `worktree ${prepared.worktree}`,
    );
    prepared.release();
  });

  it('creates no mirrors/ or repos/ directory under the Cell data directory', async () => {
    const prepared = await prepareWorkspace(contextWith(), jobWith('todo-2'));

    expect(prepared.ok).toBe(true);
    expect(existsSync(join(cellDataDir, 'mirrors'))).toBe(false);
    expect(existsSync(join(cellDataDir, 'repos'))).toBe(false);
    expect(existsSync(join(cellDataDir, 'worktrees'))).toBe(false);
    if (prepared.ok) prepared.release();
  });

  it('leaves the checked-out branch of the repo alone', async () => {
    const prepared = await prepareWorkspace(contextWith(), jobWith('todo-3'));

    expect(prepared.ok).toBe(true);
    expect(git(repoRoot, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');
    expect(git(repoRoot, 'status', '--porcelain')).toBe('');
    if (prepared.ok) prepared.release();
  });

  it('keeps .cell/ and .worktrees/ out of status through the common info/exclude, each line once', async () => {
    const first = await prepareWorkspace(contextWith(), jobWith('todo-4'));
    const second = await prepareWorkspace(contextWith(), jobWith('todo-5'));

    const lines = readFileSync(
      join(repoRoot, '.git', 'info', 'exclude'),
      'utf8',
    ).split('\n');
    expect(lines.filter((line) => line === '.cell/')).toHaveLength(1);
    expect(lines.filter((line) => line === '.worktrees/')).toHaveLength(1);
    expect(git(repoRoot, 'status', '--porcelain')).toBe('');
    if (first.ok) first.release();
    if (second.ok) second.release();
  });

  it('fetches origin on every prepare, so a new commit on the remote is the base', async () => {
    const context = contextWith();
    const first = await prepareWorkspace(context, jobWith('todo-6'));
    if (first.ok) first.release();
    const next = commitFile(origin, 'later.txt', 'later\n');

    const second = await prepareWorkspace(context, jobWith('todo-6'));

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.head).toBe(next);
    expect(git(second.worktree, 'rev-parse', 'HEAD')).toBe(next);
    second.release();
  });

  it('resolves the base from refs/remotes/origin, not the repo local branch', async () => {
    // A local main that moved on, without a push: the base is origin's main, not this one.
    git(repoRoot, 'checkout', '-q', '-B', 'local-only', 'HEAD');
    commitFile(repoRoot, 'local.txt', 'local\n');

    const prepared = await prepareWorkspace(contextWith(), jobWith('todo-7'));

    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.head).toBe(git(origin, 'rev-parse', 'HEAD'));
    prepared.release();
  });

  it('reuses an existing worktree and resets it to the base', async () => {
    const context = contextWith();
    const first = await prepareWorkspace(context, jobWith('todo-8'));
    if (!first.ok) throw new Error('first prepare failed');
    writeFileSync(join(first.worktree, 'scratch.txt'), 'leftover\n');
    first.release();

    const again = await prepareWorkspace(context, jobWith('todo-8'));

    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(existsSync(join(again.worktree, 'scratch.txt'))).toBe(false);
    again.release();
  });

  it('refuses a worktree another job of this Cell is using', async () => {
    const context = contextWith();
    const first = await prepareWorkspace(context, jobWith('busy'));
    expect(first.ok).toBe(true);

    const second = await prepareWorkspace(context, jobWith('busy'));

    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.stage).toBe('worktree');
    if (first.ok) first.release();
  });

  it('prepares concurrent jobs of one repo, each on its own worktree', async () => {
    const context = contextWith();

    const results = await Promise.all([
      prepareWorkspace(context, jobWith('par-1')),
      prepareWorkspace(context, jobWith('par-2')),
      prepareWorkspace(context, jobWith('par-3')),
    ]);

    for (const result of results) expect(result.ok).toBe(true);
    expect(
      git(repoRoot, 'worktree', 'list', '--porcelain')
        .split('\n')
        .filter(
          (line) =>
            line.startsWith('worktree ') && line.includes('/.worktrees/'),
        ),
    ).toHaveLength(3);
    for (const result of results) if (result.ok) result.release();
  });
});

describe('workspace setup and sync', () => {
  it('runs setup once per commit and skips it on the next prepare of that commit', async () => {
    const job = jobWith('todo-9', [countSetup()]);

    const first = await prepareWorkspace(contextWith(), job);
    if (first.ok) first.release();
    const second = await prepareWorkspace(contextWith(), job);
    if (second.ok) second.release();

    expect(setupRuns()).toBe(1);
  });

  it('runs setup again when a new commit is prepared', async () => {
    const job = jobWith('todo-10', [countSetup()]);
    const first = await prepareWorkspace(contextWith(), job);
    if (first.ok) first.release();
    commitFile(origin, 'next.txt', 'next\n');

    const second = await prepareWorkspace(contextWith(), job);
    if (second.ok) second.release();

    expect(setupRuns()).toBe(2);
  });

  it('reports a failed setup with its stage and the commands it ran', async () => {
    const prepared = await prepareWorkspace(
      contextWith(),
      jobWith('todo-11', ['echo building', 'exit 3']),
    );

    expect(prepared.ok).toBe(false);
    if (prepared.ok) return;
    expect(prepared.stage).toBe('setup');
    expect(prepared.detail).toContain('exited 3');
    const log = new TextDecoder().decode(prepared.log);
    expect(log).toContain('$ exit 3');
    expect(log).toContain('building');
  });
});

describe('workspace failures', () => {
  it('reports a repo whose origin cannot be fetched as a fetch failure', async () => {
    const broken = join(root, 'broken');
    makeRepo(broken);
    git(broken, 'remote', 'add', 'origin', join(root, 'missing.git'));

    const prepared = await prepareWorkspace(
      contextWith({ repoRoot: broken }),
      jobWith('todo-12'),
    );

    expect(prepared.ok).toBe(false);
    if (prepared.ok) return;
    expect(prepared.stage).toBe('fetch');
  });

  it('reports a base branch origin does not have as a worktree failure', async () => {
    const job = {
      ...jobWith('todo-13'),
      base: { branchBase: 'no-such-branch' },
    } as unknown as Job;

    const prepared = await prepareWorkspace(contextWith(), job);

    expect(prepared.ok).toBe(false);
    if (prepared.ok) return;
    expect(prepared.stage).toBe('worktree');
  });

  it('reports a pinned base the repo does not have as a worktree failure', async () => {
    const job = {
      ...jobWith('todo-14'),
      base: 'a'.repeat(40),
    } as unknown as Job;

    const prepared = await prepareWorkspace(contextWith(), job);

    expect(prepared.ok).toBe(false);
    if (prepared.ok) return;
    expect(prepared.stage).toBe('worktree');
  });
});

describe('workspace eviction', () => {
  it('evicts the least recently used worktree beyond the limit', async () => {
    const context = contextWith({ worktreeLimit: 1 });
    const first = await prepareWorkspace(context, jobWith('old'));
    if (first.ok) first.release();
    await sleep(20);

    const second = await prepareWorkspace(context, jobWith('new'));

    expect(first.ok && existsSync(first.worktree)).toBe(false);
    expect(second.ok && existsSync(second.worktree)).toBe(true);
    if (second.ok) second.release();
  });

  it('never evicts a worktree a job of this Cell is using', async () => {
    const context = contextWith({ worktreeLimit: 1 });
    const first = await prepareWorkspace(context, jobWith('busy'));
    await sleep(20);

    const second = await prepareWorkspace(context, jobWith('other'));

    expect(first.ok && existsSync(first.worktree)).toBe(true);
    if (first.ok) first.release();
    if (second.ok) second.release();
  });

  it('never evicts a worktree another Cell instance holds', async () => {
    const context = contextWith({ worktreeLimit: 1 });
    const first = await prepareWorkspace(context, jobWith('held'));
    if (!first.ok) throw new Error('first prepare failed');
    first.release();
    // Another instance of this repo's Cell holds the worktree's lease.
    const otherInstance = tryLockWorktree(repoRoot, first.worktree);
    expect(otherInstance).toBeDefined();
    await sleep(20);

    const second = await prepareWorkspace(context, jobWith('next'));

    expect(existsSync(first.worktree)).toBe(true);
    otherInstance?.release();
    if (second.ok) second.release();
  });

  it('keeps every worktree under the repo worktrees root', async () => {
    const prepared = await prepareWorkspace(contextWith(), jobWith('rooted'));

    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.worktree.startsWith(worktreesRootOf(repoRoot) + '/')).toBe(
      true,
    );
    prepared.release();
  });
});

describe('worktree path', () => {
  it('resolves a nested directory under the root', () => {
    expect(worktreePathOf('/data/worktrees/repo', 'todo/nested')).toBe(
      '/data/worktrees/repo/todo/nested',
    );
  });

  it('refuses a directory that climbs out of the root', () => {
    expect(() => worktreePathOf('/data/worktrees/repo', '../escape')).toThrow(
      /escapes/,
    );
  });
});
