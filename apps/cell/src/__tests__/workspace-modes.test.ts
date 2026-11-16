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
import { worktreesRootOf } from '../workspace/repo';
import { shellQuote } from '../workspace/shell';
import { worktreePathOf } from '../workspace/worktree';
import { cloneRepo, git, makeRepo } from '../testing/git-repo';

/**
 * The two ways a job gets its worktree (PROTOCOL §9): `fresh` places it at the base, discarding what was there;
 * `reuse` keeps the uncommitted work of earlier Stations, never resets it, and reports a worktree it does not
 * hold as missing instead of creating one.
 */

let root: string;
let origin: string;
let repoRoot: string;
let cellDataDir: string;
let counter: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'factory-cell-modes-'));
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

const jobWith = (
  mode: 'fresh' | 'reuse' | undefined,
  options: { setup?: string[]; sync?: string[] } = {},
): Job =>
  ({
    jobId: '01J0000000000000000000000J',
    orderId: 'software-factory:todo-1',
    repo: { url: origin, baseBranch: 'main', branch: 'factory/todo-1' },
    base: { branchBase: 'main' },
    workspace: {
      dir: 'todo-1',
      sync: options.sync ?? [],
      setup: options.setup ?? [],
      timeoutMs: 60_000,
      ...(mode === undefined ? {} : { mode }),
    },
  }) as unknown as Job;

const worktreeOf = (): string =>
  worktreePathOf(worktreesRootOf(repoRoot), 'todo-1');

const countSetup = (): string => `echo run >> ${shellQuote(counter)}`;
const setupRuns = (): number =>
  existsSync(counter)
    ? readFileSync(counter, 'utf8').split('\n').filter(Boolean).length
    : 0;

describe('fresh placement (station 0, or after a reset)', () => {
  it('places the worktree at the base and writes its metadata marker', async () => {
    const head = git(origin, 'rev-parse', 'HEAD');

    const prepared = await prepareWorkspace(contextWith(), jobWith('fresh'));

    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    prepared.release();
    expect(prepared.head).toBe(head);
    const marker = JSON.parse(
      readFileSync(join(worktreeOf(), '.cell', 'worktree.json'), 'utf8'),
    );
    expect(marker).toEqual({
      orderId: 'software-factory:todo-1',
      baseCommit: head,
    });
  });

  it('discards what an earlier placement left in the worktree', async () => {
    const first = await prepareWorkspace(contextWith(), jobWith('fresh'));
    if (!first.ok) throw new Error('the first placement must succeed');
    first.release();
    writeFileSync(join(worktreeOf(), 'leftover.txt'), 'stale\n');

    const again = await prepareWorkspace(contextWith(), jobWith('fresh'));

    expect(again.ok).toBe(true);
    if (again.ok) again.release();
    expect(existsSync(join(worktreeOf(), 'leftover.txt'))).toBe(false);
  });

  it('runs sync on every fresh prepare, as it always has', async () => {
    const synced = join(root, 'synced.txt');
    const first = await prepareWorkspace(
      contextWith(),
      jobWith('fresh', { sync: [`touch ${shellQuote(synced)}`] }),
    );
    expect(first.ok).toBe(true);
    if (first.ok) first.release();
    expect(existsSync(synced)).toBe(true);
  });

  it('treats a job with no mode as fresh, for jobs written before the mode was carried', async () => {
    const prepared = await prepareWorkspace(contextWith(), jobWith(undefined));

    expect(prepared.ok).toBe(true);
    if (prepared.ok) prepared.release();
    expect(existsSync(join(worktreeOf(), '.git'))).toBe(true);
  });
});

describe('named Work order branch', () => {
  it('places a fresh worktree on the Work order branch, not detached', async () => {
    const prepared = await prepareWorkspace(contextWith(), jobWith('fresh'));

    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    prepared.release();
    expect(git(worktreeOf(), 'symbolic-ref', '--short', 'HEAD')).toBe(
      'factory/todo-1',
    );
  });

  it('places a fresh worktree over a branch an evicted worktree left behind', async () => {
    const first = await prepareWorkspace(contextWith(), jobWith('fresh'));
    if (!first.ok) throw new Error('the first placement must succeed');
    first.release();
    git(repoRoot, 'worktree', 'remove', '--force', worktreeOf());
    expect(git(repoRoot, 'branch', '--list', 'factory/todo-1')).toContain(
      'factory/todo-1',
    );

    const again = await prepareWorkspace(contextWith(), jobWith('fresh'));

    expect(again.ok).toBe(true);
    if (again.ok) again.release();
    expect(git(worktreeOf(), 'symbolic-ref', '--short', 'HEAD')).toBe(
      'factory/todo-1',
    );
  });

  it('refuses to reuse a worktree that is detached rather than on the Work order branch', async () => {
    const first = await prepareWorkspace(contextWith(), jobWith('fresh'));
    if (!first.ok) throw new Error('the first placement must succeed');
    first.release();
    git(worktreeOf(), 'checkout', '--detach');

    const reused = await prepareWorkspace(contextWith(), jobWith('reuse'));

    expect(reused).toMatchObject({ ok: false, stage: 'worktree' });
  });
});

describe('reuse placement (a later Station, a retry, a delivery)', () => {
  it('keeps the uncommitted work of the worktree, tracked and untracked, intact', async () => {
    const first = await prepareWorkspace(contextWith(), jobWith('fresh'));
    if (!first.ok) throw new Error('the first placement must succeed');
    first.release();
    const work = worktreeOf();
    writeFileSync(join(work, 'README.md'), '# edited by the builder\n');
    writeFileSync(join(work, 'feature.txt'), 'built\n');

    const reused = await prepareWorkspace(contextWith(), jobWith('reuse'));

    expect(reused.ok).toBe(true);
    if (reused.ok) reused.release();
    expect(readFileSync(join(work, 'README.md'), 'utf8')).toBe(
      '# edited by the builder\n',
    );
    expect(readFileSync(join(work, 'feature.txt'), 'utf8')).toBe('built\n');
    expect(
      git(work, 'status', '--porcelain', '--untracked-files=all'),
    ).toContain('feature.txt');
  });

  it('reports a worktree this Cell does not hold as missing, creating nothing and running no setup', async () => {
    const prepared = await prepareWorkspace(
      contextWith(),
      jobWith('reuse', { setup: [countSetup()] }),
    );

    expect(prepared.ok).toBe(false);
    if (prepared.ok) return;
    expect(prepared.missing).toBe(true);
    expect(existsSync(worktreeOf())).toBe(false);
    expect(setupRuns()).toBe(0);
  });

  it('does not run sync, which could rewrite the tree', async () => {
    const first = await prepareWorkspace(contextWith(), jobWith('fresh'));
    if (!first.ok) throw new Error('the first placement must succeed');
    first.release();
    const synced = join(root, 'synced-on-reuse.txt');

    const reused = await prepareWorkspace(
      contextWith(),
      jobWith('reuse', { sync: [`touch ${shellQuote(synced)}`] }),
    );

    expect(reused.ok).toBe(true);
    if (reused.ok) reused.release();
    expect(existsSync(synced)).toBe(false);
  });
});
