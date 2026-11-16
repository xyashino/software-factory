import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Job } from '@repo/factory-core/contracts/job';
import { createSystemAdapter } from '../adapters/system/system.adapter';
import { prepareWorkspace, type PrepareContext } from '../workspace/prepare';
import { shellQuote } from '../workspace/shell';
import { cloneRepo, git } from '../testing/git-repo';
import { makeRemote, must, scratch } from './helpers/git';

let dir: string;
let remote: string;
let base: string;
let repoRoot: string;

beforeEach(async () => {
  dir = scratch('workspace');
  ({ remote, base } = await makeRemote(dir));
  repoRoot = cloneRepo(remote, join(dir, 'repo'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** The prepare context of a Cell whose repo is the clone; logs go under the scratch directory. */
const contextFor = (
  overrides: Partial<PrepareContext> = {},
): PrepareContext => ({
  shell: { system: createSystemAdapter(), logDir: join(dir, 'logs') },
  repoRoot,
  worktreeLimit: 8,
  inUse: new Set(),
  ...overrides,
});

/** A job as the Cell receives it, pointing at the fixture remote. */
const jobFor = (overrides: Partial<Job> = {}): Job =>
  ({
    jobId: '01J0000000000000000000000J',
    orderId: 'software-factory:add-login',
    projectId: 'software-factory',
    epoch: 1,
    kind: 'run_operator_station',
    repo: { url: remote, baseBranch: 'main', branch: 'factory/add-login' },
    base,
    workspace: { dir: 'worktree', sync: [], setup: [], timeoutMs: 60_000 },
    ...overrides,
  }) as Job;

describe('operator workspace', () => {
  it('prepares two Work orders of one repo at once on a fresh Cell, both ok', async () => {
    // Two preparations of one repo at the same time take the repo lock in turn: neither breaks the other.
    const [first, second] = await Promise.all([
      prepareWorkspace(
        contextFor(),
        jobFor({
          workspace: {
            dir: 'add-login',
            sync: [],
            setup: [],
            timeoutMs: 60_000,
          },
        }),
      ),
      prepareWorkspace(
        contextFor(),
        jobFor({
          orderId: 'software-factory:add-logout' as Job['orderId'],
          repo: {
            url: remote,
            baseBranch: 'main',
            branch: 'factory/add-logout',
          },
          workspace: {
            dir: 'add-logout',
            sync: [],
            setup: [],
            timeoutMs: 60_000,
          },
        }),
      ),
    ]);

    expect(first).toMatchObject({ ok: true, head: base });
    expect(second).toMatchObject({ ok: true, head: base });
    if (first.ok) first.release();
    if (second.ok) second.release();
  });

  it('creates a detached worktree at the base commit under the repo', async () => {
    const result = await prepareWorkspace(contextFor(), jobFor());

    expect(result).toMatchObject({ ok: true, head: base });
    if (!result.ok) return;
    expect(result.worktree).toBe(join(repoRoot, '.worktrees', 'worktree'));
    expect(await must(result.worktree, ['rev-parse', 'HEAD'])).toBe(base);
    expect(
      await must(result.worktree, ['rev-parse', '--abbrev-ref', 'HEAD']),
    ).toBe('HEAD');
    expect(existsSync(join(result.worktree, '.cell'))).toBe(true);
    result.release();
  });

  it('keeps the .cell directory out of the commits, through the repo info/exclude file', async () => {
    const result = await prepareWorkspace(contextFor(), jobFor());
    if (!result.ok) throw new Error(result.detail);
    writeFileSync(
      join(result.worktree, '.cell', 'scratch.txt'),
      'never committed',
    );
    writeFileSync(join(result.worktree, 'plan.md'), '# plan\n');

    expect(await must(result.worktree, ['status', '--porcelain'])).toBe(
      '?? plan.md',
    );
    result.release();
  });

  it('resolves a branch-based base to the remote branch tip', async () => {
    const result = await prepareWorkspace(
      contextFor(),
      jobFor({ base: { branchBase: 'main' } } as never),
    );

    expect(result).toMatchObject({ ok: true, head: base });
    if (result.ok) result.release();
  });

  it('reports a fetch failure with the stage it failed at', async () => {
    git(repoRoot, 'remote', 'set-url', 'origin', join(dir, 'missing.git'));

    const result = await prepareWorkspace(contextFor(), jobFor());

    expect(result).toMatchObject({ ok: false, stage: 'fetch' });
  });

  it('reports a missing base branch at the worktree stage', async () => {
    const result = await prepareWorkspace(
      contextFor(),
      jobFor({ base: { branchBase: 'no-such-branch' } } as never),
    );

    expect(result).toMatchObject({ ok: false, stage: 'worktree' });
  });

  it('resets an existing worktree to the base and removes the Operator leftovers', async () => {
    const context = contextFor();
    const first = await prepareWorkspace(context, jobFor());
    if (!first.ok) throw new Error(first.detail);
    writeFileSync(join(first.worktree, 'leftover.md'), 'from the last Cycle');
    first.release();

    const again = await prepareWorkspace(context, jobFor());

    expect(again).toMatchObject({ ok: true });
    if (!again.ok) return;
    expect(existsSync(join(again.worktree, 'leftover.md'))).toBe(false);
    expect(readFileSync(join(again.worktree, 'README.md'), 'utf8')).toBe(
      '# fixture\n',
    );
    again.release();
  });

  describe('sync and setup', () => {
    /** A file the sync and setup lines append to, so the test reads what ran. */
    const runLog = (): string => join(dir, 'runs.txt');
    const linesRun = (): string[] =>
      existsSync(runLog())
        ? readFileSync(runLog(), 'utf8').split('\n').filter(Boolean)
        : [];
    const logLine = (name: string): string =>
      `echo ${name} >> ${shellQuote(runLog())}`;

    it('runs sync, then setup, in the worktree', async () => {
      const result = await prepareWorkspace(
        contextFor(),
        jobFor({
          workspace: {
            dir: 'worktree',
            sync: [logLine('sync')],
            setup: [logLine('setup')],
            timeoutMs: 5_000,
          },
        } as never),
      );

      expect(result).toMatchObject({ ok: true });
      expect(linesRun()).toEqual(['sync', 'setup']);
      if (result.ok) result.release();
    });

    it('runs sync on every prepare and setup once per commit', async () => {
      const context = contextFor();
      const job = jobFor({
        workspace: {
          dir: 'worktree',
          sync: [logLine('sync')],
          setup: [logLine('setup')],
          timeoutMs: 5_000,
        },
      } as never);
      const first = await prepareWorkspace(context, job);
      if (first.ok) first.release();
      const again = await prepareWorkspace(context, job);
      if (again.ok) again.release();

      expect(linesRun()).toEqual(['sync', 'setup', 'sync']);
    });

    it('reports a failing sync at the sync stage and runs no setup', async () => {
      const result = await prepareWorkspace(
        contextFor(),
        jobFor({
          workspace: {
            dir: 'worktree',
            sync: ['exit 3'],
            setup: [logLine('setup')],
            timeoutMs: 5_000,
          },
        } as never),
      );

      expect(result).toMatchObject({ ok: false, stage: 'sync' });
      expect(linesRun()).toEqual([]);
    });

    it('reports a failing setup at the setup stage and runs it again on the next prepare', async () => {
      const flag = join(dir, 'ready.flag');
      const job = jobFor({
        workspace: {
          dir: 'worktree',
          sync: [],
          setup: [`test -f ${shellQuote(flag)}`],
          timeoutMs: 5_000,
        },
      } as never);
      const context = contextFor();

      const failed = await prepareWorkspace(context, job);
      expect(failed).toMatchObject({ ok: false, stage: 'setup' });

      writeFileSync(flag, '');
      const retry = await prepareWorkspace(context, job);
      expect(retry).toMatchObject({ ok: true });
      if (retry.ok) retry.release();
    });
  });
});
