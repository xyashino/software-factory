import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FactoryClient } from '@repo/factory-core/contracts/client';
import { WireFailure } from '@repo/factory-core/contracts/errors';
import { PR_ADR_TOKEN, type Job } from '@repo/factory-core/contracts/job';
import type {
  BlobRef,
  CellId,
  CommitSha,
  JobId,
  OrderId,
} from '@repo/factory-core/ids';
import type { GithubPort, PrRef } from '../ports/github.port';
import { createSystemAdapter } from '../adapters/system/system.adapter';
import { runDeliver } from '../jobs/deliver';
import type { NotifyFn } from '../jobs/notify';
import { JobStopped, type JobContext } from '../jobs/send';
import { cloneRepo, commitFile, git, makeRepo } from '../testing/git-repo';
import { factoryFiles } from '../testing/factory-fixture';

const CELL = '01J0000000000000000000000W' as CellId;
const JOB = '01J0000000000000000000000J' as JobId;
const ORDER = 'software-factory:todo-1' as OrderId;
const BRANCH = 'factory/todo-1';
const WORKTREE_DIR = 'todo-1';
const BODY = 'The body the factory rendered.';
const BODY_REF = `sha256:${'a'.repeat(64)}` as BlobRef;
const COMMIT_REF = `sha256:${'c'.repeat(64)}` as BlobRef;
const COMMIT_MESSAGE =
  'feat(factory): add the feature\n\n- Add the feature to the factory';
const PR_TITLE = 'feat(factory): add the feature';
const PR_URL = 'https://example.test/software-factory/pull/7';

/** One call the job made: the route and the request it sent. */
interface Sent {
  route: string;
  request: {
    command?: { type: string; result?: Record<string, unknown> } & Record<
      string,
      unknown
    >;
    ref?: string;
    dryRun?: boolean;
  };
}

type Answer = (sent: Sent) => unknown;

let root: string;
let origin: string;
/** The Cell's repo: a clone of origin, whose remote branches the prepare fetches. */
let repoRoot: string;
let baseHead: string;
/** The job's worktree under the repo, where the Operators left their uncommitted work. */
let worktree: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'factory-cell-deliver-'));
  origin = join(root, 'origin');
  // The repo carries its own `.factory/`: the Cell renders the PR body from it on this worktree.
  baseHead = makeRepo(origin, { 'README.md': '# repo\n', ...factoryFiles() });
  repoRoot = cloneRepo(origin, join(root, 'repo'));
  worktree = join(repoRoot, '.worktrees', WORKTREE_DIR);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** The blobs the job reads: the spec body and the builder's commit, by ref. */
const BLOB_TEXT: Record<string, string> = {
  [BODY_REF]: BODY,
  [COMMIT_REF]: COMMIT_MESSAGE,
};

/** The Factory's answers when everything is accepted: the blobs hold their texts, commands are accepted. */
const accepting: Answer = (sent) => {
  if (sent.route === 'blobGet') {
    const text = BLOB_TEXT[sent.request.ref ?? ''] ?? '';
    return {
      ref: sent.request.ref,
      base64: Buffer.from(text).toString('base64'),
    };
  }
  return { dryRun: sent.request.dryRun === true, events: [], next: null };
};

/** A fake GitHub: one PR that exists from the start or is created on the first `createPr`. */
const fakeGithub = (existing?: PrRef) => {
  const created: Array<{
    branch: string;
    base: string;
    title: string;
    body: string;
    draft: boolean;
  }> = [];
  let pr = existing;
  const port: GithubPort = {
    findPr: async () => pr,
    createPr: async (input) => {
      created.push(input);
      pr = { url: PR_URL, state: 'open', draft: input.draft };
      return { url: PR_URL };
    },
    markReady: async () => undefined,
    updateBody: async () => undefined,
  };
  return { port, created };
};

/** A context whose client records every call and answers from `answer`. */
const contextWith = (
  answer: Answer = accepting,
  github = fakeGithub(),
  notify?: NotifyFn,
) => {
  const calls: Sent[] = [];
  const client = {
    call: async (route: string, request: unknown) => {
      const sent = { route, request: request as Sent['request'] };
      calls.push(sent);
      return answer(sent);
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
    githubFor: () => github.port,
    ...(notify ? { notify } : {}),
  };
  return { context, calls, github };
};

/**
 * A deliver job on the origin repo, based on `base` (a branch name or a commit). The worktree is reused:
 * the uncommitted work of the Stations is in it (PROTOCOL §9).
 */
const deliverJob = (
  base: Job['base'] = { branchBase: 'main' },
  baseBranch = 'main',
): Job =>
  ({
    jobId: JOB,
    orderId: ORDER,
    projectId: 'software-factory',
    epoch: 3,
    kind: 'deliver',
    repo: { url: origin, baseBranch, branch: BRANCH },
    base,
    workspace: {
      dir: WORKTREE_DIR,
      sync: [],
      setup: [],
      timeoutMs: 60_000,
      mode: 'reuse',
    },
    deliver: {
      taskId: 'todo-1',
      type: 'feat',
      title: 'Add the feature',
      todoBodyBlob: BODY_REF,
      commitBlob: COMMIT_REF,
      logCommand: `factory log ${ORDER}`,
      verification: [
        { kind: 'operator', stationId: 'build', profile: 'builder' },
      ],
    },
  }) as unknown as Job;

const signal = (): AbortSignal => new AbortController().signal;

/**
 * Creates the job's worktree on `commit` (detached), as Station 0 would have, unless it exists already.
 * Returns the worktree path.
 */
const placeWorktree = (commit: string = baseHead): string => {
  if (git(repoRoot, 'worktree', 'list', '--porcelain').includes(worktree)) {
    return worktree;
  }
  // The commit may exist only on origin (a predecessor's branch): the Cell's repo fetches before it is placed.
  git(repoRoot, 'fetch', '--quiet', 'origin');
  mkdirSync(dirname(worktree), { recursive: true });
  git(repoRoot, 'worktree', 'add', '--detach', worktree, commit);
  return worktree;
};

/** Writes a file into the worktree, uncommitted: the way an Operator leaves its work. */
const work = (name: string, text: string): void => {
  placeWorktree();
  const path = join(worktree, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};

/** The sha the work branch points at on the origin, or the empty string when it does not exist. */
const branchTip = (): string => {
  const listed = git(origin, 'branch', '--list', BRANCH);
  return listed === '' ? '' : git(origin, 'rev-parse', `refs/heads/${BRANCH}`);
};

/** The files a commit holds, one path per line. */
const filesOf = (commit: string): string[] =>
  git(origin, 'ls-tree', '-r', '--name-only', commit).split('\n');

/** The results of the real (not dry-run) ReportDelivery commands, in order. */
const reportsOf = (calls: Sent[]) =>
  calls
    .filter(
      (call) =>
        call.route === 'submitCommand' &&
        call.request.command?.type === 'ReportDelivery' &&
        call.request.dryRun !== true,
    )
    .map((call) => call.request.command?.result);

/** Makes or moves `name` on origin to `from` plus one commit per file. Returns the new tip. */
const branchOnOrigin = (
  name: string,
  from: string,
  files: Record<string, string>,
): string => {
  git(origin, 'checkout', '-q', '-B', name, from);
  for (const [file, text] of Object.entries(files)) {
    commitFile(origin, file, text);
  }
  const tip = git(origin, 'rev-parse', 'HEAD');
  git(origin, 'checkout', '-q', 'main');
  return tip;
};

describe('deliver job (deferred commit, PROTOCOL §8.3)', () => {
  it('delivers the uncommitted work of the worktree as one commit on the base, with the rendered message and PR', async () => {
    work('wip-1.txt', 'one\n');
    work('wip-2.txt', 'two\n');
    const { context, calls, github } = contextWith();

    await runDeliver(context, deliverJob(), signal());

    const tip = branchTip();
    expect(git(origin, 'rev-list', '--count', `main..${BRANCH}`)).toBe('1');
    expect(git(origin, 'rev-parse', `${tip}^`)).toBe(baseHead);
    expect(git(origin, 'log', '-1', '--format=%B', tip)).toBe(COMMIT_MESSAGE);
    expect(filesOf(tip)).toEqual(
      expect.arrayContaining(['wip-1.txt', 'wip-2.txt']),
    );
    expect(github.created).toEqual([
      expect.objectContaining({
        branch: BRANCH,
        base: 'main',
        title: PR_TITLE,
        draft: false,
      }),
    ]);
    expect(github.created[0]?.body).toContain('Task: `todo-1` (feat)');
    expect(github.created[0]?.body).toContain(BODY);
    expect(reportsOf(calls)).toEqual([
      { status: 'finished', prUrl: PR_URL, commit: tip },
    ]);
  });

  it('leaves the worktree on the delivered commit, and the remote holds no WIP commit', async () => {
    work('wip-1.txt', 'one\n');
    const { context } = contextWith();

    await runDeliver(context, deliverJob(), signal());

    expect(git(worktree, 'rev-parse', 'HEAD')).toBe(branchTip());
    expect(git(origin, 'log', '--format=%s', BRANCH)).not.toContain('wip(');
  });

  it('falls back to a generated commit when the builder wrote no usable one', async () => {
    work('wip-1.txt', 'one\n');
    const noCommit = deliverJob();
    const job = {
      ...noCommit,
      deliver: { ...noCommit.deliver, commitBlob: undefined },
    } as Job;
    const { context, github } = contextWith();

    await runDeliver(context, job, signal());

    const tip = branchTip();
    expect(git(origin, 'log', '-1', '--format=%s', tip)).toBe(
      'feat(factory): Add the feature',
    );
    expect(github.created[0]?.title).toBe('feat(factory): Add the feature');
  });

  it('rebases the staged work onto a moved base before it squashes', async () => {
    work('feature.txt', 'feature\n');
    const movedBase = commitFile(origin, 'other.txt', 'moved\n');
    const { context } = contextWith();

    await runDeliver(context, deliverJob(), signal());

    const tip = branchTip();
    expect(git(origin, 'rev-parse', `${tip}^`)).toBe(movedBase);
    expect(git(origin, 'rev-list', '--count', `main..${BRANCH}`)).toBe('1');
    expect(filesOf(tip)).toEqual(
      expect.arrayContaining(['feature.txt', 'other.txt']),
    );
  });

  it('reports a rebase conflict as failed, pushes nothing, and keeps the work in the worktree', async () => {
    work('shared.txt', 'branch side\n');
    commitFile(origin, 'shared.txt', 'main side\n');
    const { context, calls, github } = contextWith();

    await runDeliver(context, deliverJob(), signal());

    expect(branchTip()).toBe('');
    expect(github.created).toEqual([]);
    const [report] = reportsOf(calls);
    expect(report).toMatchObject({ status: 'failed' });
    expect(String(report?.detail)).toMatch(/^rebase conflict/);
    // HEAD is back on the commit the worktree started from, and the work is still there.
    expect(git(worktree, 'rev-parse', 'HEAD')).toBe(baseHead);
    expect(git(worktree, 'status', '--porcelain')).toContain('shared.txt');
  });

  it('reports a failed delivery and pushes nothing when the repo has no .factory/', async () => {
    work('wip-1.txt', 'one\n');
    git(origin, 'rm', '-r', '-q', '.factory');
    git(origin, 'commit', '-q', '-m', 'drop the definitions');
    const { context, calls, github } = contextWith();

    await runDeliver(context, deliverJob(), signal());

    expect(branchTip()).toBe('');
    expect(github.created).toEqual([]);
    const [report] = reportsOf(calls);
    expect(report).toMatchObject({ status: 'failed' });
    expect(String(report?.detail)).toMatch(/invalid \.factory\//);
  });

  it('reuses the open PR of the branch and creates none', async () => {
    work('wip-1.txt', 'one\n');
    const existing: PrRef = {
      url: 'https://example.test/pull/3',
      state: 'open',
      draft: false,
    };
    const github = fakeGithub(existing);
    const { context, calls } = contextWith(accepting, github);

    await runDeliver(context, deliverJob(), signal());

    expect(github.created).toEqual([]);
    expect(reportsOf(calls)).toEqual([
      { status: 'finished', prUrl: existing.url, commit: branchTip() },
    ]);
  });

  it('takes over a [BLOCKED] draft: it gets the delivery title and body, and is marked ready', async () => {
    work('wip-1.txt', 'one\n');
    const draft: PrRef = {
      url: 'https://example.test/pull/4',
      state: 'open',
      draft: true,
    };
    const github = fakeGithub(draft);
    const updates: Array<{ url: string; body: string; title?: string }> = [];
    const readied: string[] = [];
    const port: GithubPort = {
      ...github.port,
      updateBody: async (url, body, title) => {
        updates.push({ url, body, title });
      },
      markReady: async (url) => {
        readied.push(url);
      },
    };
    const { context, calls } = contextWith(accepting, { ...github, port });

    await runDeliver(context, deliverJob(), signal());

    expect(github.created).toEqual([]);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ url: draft.url, title: PR_TITLE });
    expect(updates[0]?.body).not.toContain('[BLOCKED]');
    expect(readied).toEqual([draft.url]);
    expect(reportsOf(calls)).toEqual([
      { status: 'finished', prUrl: draft.url, commit: branchTip() },
    ]);
  });

  it('renders the PR body from the todo body and the repo template, not from the title', async () => {
    work('wip-1.txt', 'one\n');
    const { context, github } = contextWith();

    await runDeliver(context, deliverJob(), signal());

    expect(github.created[0]?.body).toContain(BODY);
    expect(github.created[0]?.body).not.toBe(PR_TITLE);
  });

  it('fills the PR ADR section with the decisions/ entry the commit adds', async () => {
    work('decisions/20261115-120000-factory-add-thing.md', '---\n');
    work('wip-1.txt', 'one\n');
    const { context, github } = contextWith();

    await runDeliver(context, deliverJob(), signal());

    expect(github.created[0]?.body).toContain(
      '- Path: `decisions/20261115-120000-factory-add-thing.md`',
    );
    expect(github.created[0]?.body).not.toContain(PR_ADR_TOKEN);
  });

  it('says so in the PR when the commit adds no decisions/ entry', async () => {
    work('wip-1.txt', 'one\n');
    const { context, github } = contextWith();

    await runDeliver(context, deliverJob(), signal());

    expect(github.created[0]?.body).toContain(
      '_No decisions/ entry recorded for this change._',
    );
    expect(github.created[0]?.body).not.toContain(PR_ADR_TOKEN);
  });

  it('removes the todo file of its task in the same commit', async () => {
    work('todos/todo-1.md', '---\nstatus: todo\n---\n');
    work('wip-1.txt', 'one\n');
    const { context } = contextWith();

    await runDeliver(context, deliverJob(), signal());

    const files = filesOf(branchTip());
    expect(files).toContain('wip-1.txt');
    expect(files).not.toContain('todos/todo-1.md');
  });

  it('delivers an API-created order whose repo holds no todo file, and removes nothing', async () => {
    work('wip-1.txt', 'one\n');
    const { context, calls } = contextWith();

    await runDeliver(context, deliverJob(), signal());

    expect(reportsOf(calls)).toEqual([
      expect.objectContaining({ status: 'finished', commit: branchTip() }),
    ]);
    expect(filesOf(branchTip())).toContain('wip-1.txt');
  });

  it('delivers again onto the same branch and PR after a reopen', async () => {
    work('wip-1.txt', 'one\n');
    const first = contextWith();
    await runDeliver(first.context, deliverJob(), signal());
    const delivered = branchTip();
    work('rework.txt', 'rework\n');
    const second = contextWith(accepting, first.github);

    await runDeliver(
      second.context,
      deliverJob(delivered as CommitSha),
      signal(),
    );

    expect(first.github.created).toHaveLength(1);
    expect(reportsOf(second.calls)).toEqual([
      { status: 'finished', prUrl: PR_URL, commit: branchTip() },
    ]);
    expect(git(origin, 'rev-list', '--count', `main..${BRANCH}`)).toBe('1');
    expect(filesOf(branchTip())).toEqual(
      expect.arrayContaining(['wip-1.txt', 'rework.txt']),
    );
  });

  it('stops before any push when the dry run finds a stale epoch', async () => {
    work('wip-1.txt', 'one\n');
    const staleOnDryRun: Answer = (sent) => {
      if (sent.request.dryRun === true) {
        throw new WireFailure({ code: 'stale_epoch', current: 4 });
      }
      return accepting(sent);
    };
    const { context, calls, github } = contextWith(staleOnDryRun);

    await expect(runDeliver(context, deliverJob(), signal())).rejects.toThrow(
      JobStopped,
    );

    expect(branchTip()).toBe('');
    expect(github.created).toEqual([]);
    expect(reportsOf(calls)).toEqual([]);
    expect(git(worktree, 'rev-parse', 'HEAD')).toBe(baseHead);
  });

  it('reports a failed push and overwrites nothing when the remote moved', async () => {
    work('wip-1.txt', 'one\n');
    let moved = '';
    const movedOnDryRun: Answer = (sent) => {
      if (
        sent.request.command?.type === 'ReportDelivery' &&
        sent.request.dryRun === true
      ) {
        moved = branchOnOrigin(BRANCH, baseHead, {
          'pushed-by-someone-else.txt': 'theirs\n',
        });
      }
      return accepting(sent);
    };
    const { context, calls, github } = contextWith(movedOnDryRun);

    await runDeliver(context, deliverJob(), signal());

    expect(branchTip()).toBe(moved);
    expect(github.created).toEqual([]);
    const [report] = reportsOf(calls);
    expect(report).toMatchObject({ status: 'failed' });
    expect(String(report?.detail)).toMatch(/^push refused/);
  });
});

/** A job on a stacked base: the branch is `factory/todo-1`, its base the predecessor's branch. */
const stackedJob = (predecessor: string): Job =>
  deliverJob({ branchBase: predecessor }, predecessor);

describe('deliver job: the delivery toast', () => {
  it('names the delivered todo and its PR with a done sound', async () => {
    work('wip-1.txt', 'one\n');
    const notify = vi.fn(async () => undefined);
    const { context } = contextWith(accepting, fakeGithub(), notify);

    await runDeliver(context, deliverJob(), signal());

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith('Delivered: todo-1', {
      body: PR_URL,
      sound: 'done',
    });
  });

  it('stays silent when the delivery fails', async () => {
    work('wip-1.txt', 'one\n');
    git(origin, 'rm', '-r', '-q', '.factory');
    git(origin, 'commit', '-q', '-m', 'drop the definitions');
    const notify = vi.fn(async () => undefined);
    const { context, calls } = contextWith(accepting, fakeGithub(), notify);

    await runDeliver(context, deliverJob(), signal());

    expect(reportsOf(calls)).toEqual([
      expect.objectContaining({ status: 'failed' }),
    ]);
    expect(notify).not.toHaveBeenCalled();
  });
});

describe('deliver job on a stacked base (CORE §12.5)', () => {
  it('delivers onto factory/<predecessor>: the PR targets it and the predecessor commit is the parent', async () => {
    const predTip = branchOnOrigin('factory/todo-0', baseHead, {
      'pred.txt': 'pred\n',
    });
    placeWorktree(predTip);
    work('todos/todo-1.md', '# todo\n');
    work('wip.txt', 'wip\n');
    const { context, calls, github } = contextWith();

    await runDeliver(context, stackedJob('factory/todo-0'), signal());

    const tip = branchTip();
    expect(git(origin, 'rev-parse', `${tip}^`)).toBe(predTip);
    expect(
      git(origin, 'rev-list', '--count', `factory/todo-0..${BRANCH}`),
    ).toBe('1');
    expect(filesOf(tip)).toEqual(
      expect.arrayContaining(['pred.txt', 'wip.txt']),
    );
    expect(filesOf(tip)).not.toContain('todos/todo-1.md');
    expect(github.created).toEqual([
      expect.objectContaining({ branch: BRANCH, base: 'factory/todo-0' }),
    ]);
    expect(reportsOf(calls)).toEqual([
      { status: 'finished', prUrl: PR_URL, commit: tip },
    ]);
  });

  it('delivers onto feat/<slug>: the PR targets the plan branch', async () => {
    const planTip = branchOnOrigin('feat/xyz', baseHead, {
      'plan.txt': 'plan\n',
    });
    placeWorktree(planTip);
    work('wip.txt', 'wip\n');
    const { context, github } = contextWith();

    await runDeliver(context, stackedJob('feat/xyz'), signal());

    const tip = branchTip();
    expect(git(origin, 'rev-parse', `${tip}^`)).toBe(planTip);
    expect(github.created).toEqual([
      expect.objectContaining({ branch: BRANCH, base: 'feat/xyz' }),
    ]);
  });

  it('reports delivery_failed and pushes nothing when the base branch is missing', async () => {
    work('wip.txt', 'wip\n');
    const { context, calls, github } = contextWith();

    await runDeliver(context, stackedJob('factory/todo-gone'), signal());

    expect(branchTip()).toBe('');
    expect(github.created).toEqual([]);
    const [report] = reportsOf(calls);
    expect(report).toMatchObject({ status: 'failed' });
    expect(String(report?.detail)).toMatch(/factory\/todo-gone/);
  });

  it('reports delivery_failed and pushes nothing when the predecessor was rewritten under the work', async () => {
    const first = branchOnOrigin('factory/todo-0', baseHead, {
      'shared.txt': 'pred one\n',
    });
    placeWorktree(first);
    work('shared.txt', 'work side\n');
    // The predecessor is reopened and rewritten: the work no longer rebases cleanly.
    branchOnOrigin('factory/todo-0', baseHead, { 'shared.txt': 'pred two\n' });
    const { context, calls, github } = contextWith();

    await runDeliver(context, stackedJob('factory/todo-0'), signal());

    expect(branchTip()).toBe('');
    expect(github.created).toEqual([]);
    const [report] = reportsOf(calls);
    expect(report).toMatchObject({ status: 'failed' });
    expect(String(report?.detail)).toMatch(/^rebase conflict/);
  });
});

/** The deliver job with `deliver.requireAdr` set as the Line sets it (`undefined` leaves it unset). */
const gatedJob = (requireAdr: boolean | undefined): Job => {
  const job = deliverJob();
  return { ...job, deliver: { ...job.deliver, requireAdr } } as Job;
};

/**
 * Installs a post-commit hook in the Cell's repo (the worktrees share its hooks). It runs after every commit
 * the worktree makes, the staging one included, so the script skips the staging commit by its subject.
 */
const postCommitHook = (script: string): void => {
  writeFileSync(
    join(repoRoot, '.git', 'hooks', 'post-commit'),
    `#!/bin/sh\n[ "$(git log -1 --format=%s)" = "staging delivery" ] || ${script}\n`,
    { mode: 0o755 },
  );
};

describe('deliver job: the pre-push gate', () => {
  it('refuses to push when a file is left uncommitted after the delivery commit', async () => {
    postCommitHook('echo left > stray.txt');
    work('wip-1.txt', 'one\n');
    const { context, calls, github } = contextWith();

    await runDeliver(context, deliverJob(), signal());

    expect(branchTip()).toBe('');
    expect(github.created).toEqual([]);
    const [report] = reportsOf(calls);
    expect(report).toMatchObject({ status: 'failed' });
    expect(String(report?.detail)).toMatch(
      /^delivery refused: uncommitted files remain.*stray\.txt/,
    );
  });

  it('ignores files under .cell/ when it checks the worktree is clean', async () => {
    postCommitHook('mkdir -p .cell && echo state > .cell/state.json');
    work('wip-1.txt', 'one\n');
    const { context, calls } = contextWith();

    await runDeliver(context, deliverJob(), signal());

    expect(reportsOf(calls)).toEqual([
      expect.objectContaining({ status: 'finished', commit: branchTip() }),
    ]);
  });

  it('refuses to push with requireAdr when the commit adds no decisions/ entry', async () => {
    work('wip-1.txt', 'one\n');
    const { context, calls, github } = contextWith();

    await runDeliver(context, gatedJob(true), signal());

    expect(branchTip()).toBe('');
    expect(github.created).toEqual([]);
    const [report] = reportsOf(calls);
    expect(report).toMatchObject({ status: 'failed' });
    expect(String(report?.detail)).toMatch(
      /^delivery refused: expected exactly one new decisions\/ entry, found 0$/,
    );
  });

  it('delivers with requireAdr when the commit adds exactly one decisions/ entry', async () => {
    work('decisions/20261115-120000-factory-add-thing.md', '---\n');
    work('wip-1.txt', 'one\n');
    const { context, calls } = contextWith();

    await runDeliver(context, gatedJob(true), signal());

    expect(reportsOf(calls)).toEqual([
      expect.objectContaining({ status: 'finished', commit: branchTip() }),
    ]);
  });

  it('refuses to push with requireAdr when the commit adds two decisions/ entries', async () => {
    work('decisions/20261115-120000-factory-add-thing.md', '---\n');
    work('decisions/20261115-120100-factory-add-other.md', '---\n');
    const { context, calls, github } = contextWith();

    await runDeliver(context, gatedJob(true), signal());

    expect(branchTip()).toBe('');
    expect(github.created).toEqual([]);
    const [report] = reportsOf(calls);
    expect(String(report?.detail)).toMatch(
      /expected exactly one new decisions\/ entry, found 2$/,
    );
  });

  it('delivers without a decisions/ entry when requireAdr is false', async () => {
    work('wip-1.txt', 'one\n');
    const { context, calls } = contextWith();

    await runDeliver(context, gatedJob(false), signal());

    expect(reportsOf(calls)).toEqual([
      expect.objectContaining({ status: 'finished', commit: branchTip() }),
    ]);
  });
});
