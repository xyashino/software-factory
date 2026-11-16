import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FactoryClient } from '@repo/factory-core/contracts/client';
import type { Job } from '@repo/factory-core/contracts/job';
import type { CellId, JobId, OrderId } from '@repo/factory-core/ids';
import type { GithubPort } from '../ports/github.port';
import { createSystemAdapter } from '../adapters/system/system.adapter';
import { runPublishBlocked } from '../jobs/publish-blocked';
import type { NotifyFn } from '../jobs/notify';
import type { JobContext } from '../jobs/send';
import { fakeGithub } from '../testing/fake-github';
import { factoryFiles } from '../testing/factory-fixture';
import { cloneRepo, git, makeRepo } from '../testing/git-repo';

const CELL = '01J0000000000000000000000W' as CellId;
const JOB = '01J0000000000000000000000J' as JobId;
const ORDER = 'software-factory:todo-1' as OrderId;
const BRANCH = 'factory/todo-1';
const WORKTREE_DIR = 'todo-1';
const TITLE = '[BLOCKED] todo-1 cycle_blocked';
const DETAIL = 'cycle 01J0000000000000000000000C is blocked';

/** One call the job made: the route and the request it sent. */
interface Sent {
  route: string;
  request: {
    command?: { type: string; result?: Record<string, unknown> };
    dryRun?: boolean;
  };
}

let root: string;
let origin: string;
let repoRoot: string;
let worktree: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'factory-cell-publish-blocked-'));
  origin = join(root, 'origin');
  makeRepo(origin, { 'README.md': '# repo\n', ...factoryFiles() });
  repoRoot = cloneRepo(origin, join(root, 'repo'));
  worktree = join(repoRoot, '.worktrees', WORKTREE_DIR);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A context whose client records every call and accepts every command (dry runs included). */
const contextWith = (github: GithubPort, notify?: NotifyFn) => {
  const calls: Sent[] = [];
  const client = {
    call: async (route: string, request: unknown) => {
      const sent = { route, request: request as Sent['request'] };
      calls.push(sent);
      return { dryRun: sent.request.dryRun === true, events: [], next: null };
    },
  } as unknown as FactoryClient;
  const context: JobContext = {
    client,
    cellId: CELL,
    system: createSystemAdapter(),
    repoRoot,
    cellDataDir: join(root, 'cell'),
    worktreeLimit: 8,
    inUse: new Set(),
    githubFor: () => github,
    ...(notify ? { notify } : {}),
  };
  return { context, calls };
};

/** A publish job for the todo's blocked Andon, on the reused worktree. */
const publishJob = (): Job =>
  ({
    jobId: JOB,
    orderId: ORDER,
    projectId: 'software-factory',
    epoch: 3,
    kind: 'publish_blocked',
    repo: { url: origin, baseBranch: 'main', branch: BRANCH },
    base: { branchBase: 'main' },
    workspace: {
      dir: WORKTREE_DIR,
      sync: [],
      setup: [],
      timeoutMs: 60_000,
      mode: 'reuse',
    },
    blocked: {
      taskId: 'todo-1',
      reason: 'cycle_blocked',
      detail: DETAIL,
      logCommand: `factory log ${ORDER}`,
    },
  }) as unknown as Job;

const signal = (): AbortSignal => new AbortController().signal;

/** Places the job's worktree on the base, as Station 0 would have. */
const placeWorktree = (): void => {
  git(repoRoot, 'fetch', '--quiet', 'origin');
  mkdirSync(dirname(worktree), { recursive: true });
  git(repoRoot, 'worktree', 'add', '-B', BRANCH, worktree, 'origin/main');
};

/** Writes a file into the worktree, uncommitted: the way an Operator leaves its work. */
const work = (name: string, text: string): void => {
  placeWorktree();
  writeFileSync(join(worktree, name), text);
};

/** The sha the work branch points at on origin, or the empty string when it does not exist. */
const branchTip = (): string => {
  const listed = git(origin, 'branch', '--list', BRANCH);
  return listed === '' ? '' : git(origin, 'rev-parse', `refs/heads/${BRANCH}`);
};

/** The ReportBlockedPr commands sent for real (not dry runs), in order. */
const reportsOf = (calls: Sent[]) =>
  calls
    .filter(
      (call) =>
        call.route === 'submitCommand' &&
        call.request.command?.type === 'ReportBlockedPr' &&
        call.request.dryRun !== true,
    )
    .map((call) => call.request.command?.result);

describe('publish_blocked: no change against the base', () => {
  it('reports no_changes and publishes nothing when the worktree matches the base', async () => {
    placeWorktree();
    const github = fakeGithub();
    const { context, calls } = contextWith(github);

    await runPublishBlocked(context, publishJob(), signal());

    expect(reportsOf(calls)).toEqual([{ status: 'no_changes' }]);
    expect(branchTip()).toBe('');
    expect(github.created).toEqual([]);
  });
});

describe('publish_blocked: changes against the base', () => {
  it('pushes the work and opens a draft [BLOCKED] PR rendered from the blocked template', async () => {
    work('feature.txt', 'half-done\n');
    const github = fakeGithub();
    const { context, calls } = contextWith(github);

    await runPublishBlocked(context, publishJob(), signal());

    const tip = branchTip();
    expect(tip).not.toBe('');
    expect(git(origin, 'ls-tree', '-r', '--name-only', tip)).toContain(
      'feature.txt',
    );
    expect(github.created).toHaveLength(1);
    expect(github.created[0]).toMatchObject({
      branch: BRANCH,
      base: 'main',
      title: TITLE,
      draft: true,
    });
    expect(github.created[0]?.body).toContain(DETAIL);
    expect(github.created[0]?.body).toContain(`factory log ${ORDER}`);
    expect(reportsOf(calls)).toEqual([
      {
        status: 'published',
        prUrl: github.prs[0]?.url,
        commit: tip,
      },
    ]);
  });

  it('updates the open PR for the branch instead of opening a second one', async () => {
    work('feature.txt', 'half-done\n');
    const github = fakeGithub();
    github.seed({
      url: 'https://example.test/software-factory/pull/3',
      state: 'open',
      draft: true,
      head: BRANCH,
      base: 'main',
    });
    const { context, calls } = contextWith(github);

    await runPublishBlocked(context, publishJob(), signal());

    expect(github.created).toEqual([]);
    expect(
      github.bodies.get('https://example.test/software-factory/pull/3'),
    ).toContain(DETAIL);
    expect(reportsOf(calls)).toMatchObject([
      {
        status: 'published',
        prUrl: 'https://example.test/software-factory/pull/3',
      },
    ]);
  });
});

describe('publish_blocked: failures never fail the Andon', () => {
  it('reports a refused push as failed and opens no PR', async () => {
    work('feature.txt', 'half-done\n');
    // origin refuses every push: the Cell's push is refused, and the publish reports why.
    const hook = join(origin, '.git', 'hooks', 'pre-receive');
    writeFileSync(hook, '#!/bin/sh\necho "refused by test" >&2\nexit 1\n');
    chmodSync(hook, 0o755);
    const github = fakeGithub();
    const { context, calls } = contextWith(github);

    await runPublishBlocked(context, publishJob(), signal());

    expect(github.created).toEqual([]);
    const [report] = reportsOf(calls);
    expect(report).toMatchObject({ status: 'failed' });
    expect(String(report?.detail)).toContain('push refused');
  });

  it('reports a GitHub failure as failed and never throws', async () => {
    work('feature.txt', 'half-done\n');
    const github = fakeGithub();
    const failing: GithubPort = {
      ...github,
      createPr: async () => {
        throw new Error('gh pr create: rate limited');
      },
    };
    const { context, calls } = contextWith(failing);

    await expect(
      runPublishBlocked(context, publishJob(), signal()),
    ).resolves.toBeUndefined();

    expect(reportsOf(calls)).toMatchObject([
      { status: 'failed', detail: expect.stringContaining('rate limited') },
    ]);
  });

  it('stops without a report when its signal has already fired', async () => {
    work('feature.txt', 'half-done\n');
    const github = fakeGithub();
    const { context, calls } = contextWith(github);
    const aborted = new AbortController();
    aborted.abort('shutdown');

    await runPublishBlocked(context, publishJob(), aborted.signal);

    expect(reportsOf(calls)).toEqual([]);
    expect(github.created).toEqual([]);
  });
});

describe('publish_blocked: the Andon toast', () => {
  it('names the block and the published PR URL with a request sound', async () => {
    work('feature.txt', 'half-done\n');
    const github = fakeGithub();
    const notify = vi.fn(async () => undefined);
    const { context } = contextWith(github, notify);

    await runPublishBlocked(context, publishJob(), signal());

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith('Blocked: todo-1', {
      body: `cycle_blocked ${github.prs[0]?.url}`,
      sound: 'request',
    });
  });

  it('still reports the Andon when the toast is refused', async () => {
    work('feature.txt', 'half-done\n');
    const github = fakeGithub();
    const notify = vi.fn(async () => {
      throw new Error('herdr is not running');
    });
    const { context, calls } = contextWith(github, notify);

    await runPublishBlocked(context, publishJob(), signal());

    expect(notify).toHaveBeenCalledTimes(1);
    expect(reportsOf(calls)).toEqual([
      {
        status: 'published',
        prUrl: github.prs[0]?.url,
        commit: expect.any(String),
      },
    ]);
  });
});
