import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
import { JobStopped, type JobContext } from '../jobs/send';
import { cloneRepo, commitFile, git, makeRepo } from '../testing/git-repo';
import { factoryFiles } from '../testing/factory-fixture';

const CELL = '01J0000000000000000000000W' as CellId;
const JOB = '01J0000000000000000000000J' as JobId;
const ORDER = 'software-factory:todo-1' as OrderId;
const BRANCH = 'factory/todo-1';
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

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'factory-cell-deliver-'));
  origin = join(root, 'origin');
  // The repo carries its own `.factory/`: the Cell renders the PR body from it on this worktree.
  baseHead = makeRepo(origin, { 'README.md': '# repo\n', ...factoryFiles() });
  repoRoot = cloneRepo(origin, join(root, 'repo'));
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
const contextWith = (answer: Answer = accepting, github = fakeGithub()) => {
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
  };
  return { context, calls, github };
};

/** A deliver job on the origin repo, based on `base` (a branch name or a commit). */
const deliverJob = (base: Job['base'] = { branchBase: 'main' }): Job =>
  ({
    jobId: JOB,
    orderId: ORDER,
    projectId: 'software-factory',
    epoch: 3,
    kind: 'deliver',
    repo: { url: origin, baseBranch: 'main', branch: BRANCH },
    base,
    workspace: { dir: 'todo-1', sync: [], setup: [], timeoutMs: 60_000 },
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

/** Commits one file on the work branch, made from main the first time. Returns the commit sha. */
const commitOnBranch = (name: string, text: string): string => {
  const existing = git(origin, 'branch', '--list', BRANCH);
  git(
    origin,
    'checkout',
    '-q',
    ...(existing === '' ? ['-b', BRANCH, 'main'] : [BRANCH]),
  );
  const sha = commitFile(origin, name, text);
  git(origin, 'checkout', '-q', 'main');
  return sha;
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

describe('deliver job', () => {
  it('delivers the work branch as one commit on the base, with the rendered message and PR', async () => {
    commitOnBranch('wip-1.txt', 'one\n');
    const tipBefore = commitOnBranch('wip-2.txt', 'two\n');
    const { context, calls, github } = contextWith();

    await runDeliver(context, deliverJob(), signal());

    const tip = branchTip();
    expect(git(origin, 'rev-list', '--count', `main..${BRANCH}`)).toBe('1');
    expect(git(origin, 'rev-parse', `${tip}^`)).toBe(baseHead);
    expect(git(origin, 'log', '-1', '--format=%B', tip)).toBe(COMMIT_MESSAGE);
    expect(filesOf(tip)).toEqual(
      expect.arrayContaining(['wip-1.txt', 'wip-2.txt']),
    );
    expect(tip).not.toBe(tipBefore);
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

  it('falls back to a generated commit when the builder wrote no usable one', async () => {
    commitOnBranch('wip-1.txt', 'one\n');
    const noCommit = { ...deliverJob() } as Job;
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

  it('rebases the branch onto a moved base before it squashes', async () => {
    commitOnBranch('feature.txt', 'feature\n');
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

  it('reports a rebase conflict as failed and pushes nothing', async () => {
    const tipBefore = commitOnBranch('shared.txt', 'branch side\n');
    commitFile(origin, 'shared.txt', 'main side\n');
    const { context, calls, github } = contextWith();

    await runDeliver(context, deliverJob(), signal());

    expect(branchTip()).toBe(tipBefore);
    expect(github.created).toEqual([]);
    const [report] = reportsOf(calls);
    expect(report).toMatchObject({ status: 'failed' });
    expect(String(report?.detail)).toMatch(/^rebase conflict/);
  });

  it('reports a failed delivery and pushes nothing when the repo has no .factory/', async () => {
    const tipBefore = commitOnBranch('wip-1.txt', 'one\n');
    git(origin, 'checkout', '-q', 'main');
    git(origin, 'rm', '-r', '-q', '.factory');
    git(origin, 'commit', '-q', '-m', 'drop the definitions');
    const { context, calls, github } = contextWith();

    await runDeliver(context, deliverJob(), signal());

    expect(branchTip()).toBe(tipBefore);
    expect(github.created).toEqual([]);
    const [report] = reportsOf(calls);
    expect(report).toMatchObject({ status: 'failed' });
    expect(String(report?.detail)).toMatch(/invalid \.factory\//);
  });

  it('reuses the open PR of the branch and creates none', async () => {
    commitOnBranch('wip-1.txt', 'one\n');
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

  it('renders the PR body from the todo body and the repo template, not from the title', async () => {
    commitOnBranch('wip-1.txt', 'one\n');
    const { context, github } = contextWith();

    await runDeliver(context, deliverJob(), signal());

    expect(github.created[0]?.body).toContain(BODY);
    expect(github.created[0]?.body).not.toBe(PR_TITLE);
  });

  it('fills the PR ADR section with the decisions/ entry the commit adds', async () => {
    commitOnBranch('decisions/20261115-120000-factory-add-thing.md', '---\n');
    commitOnBranch('wip-1.txt', 'one\n');
    const { context, github } = contextWith();

    await runDeliver(context, deliverJob(), signal());

    expect(github.created[0]?.body).toContain(
      '- Path: `decisions/20261115-120000-factory-add-thing.md`',
    );
    expect(github.created[0]?.body).not.toContain(PR_ADR_TOKEN);
  });

  it('says so in the PR when the commit adds no decisions/ entry', async () => {
    commitOnBranch('wip-1.txt', 'one\n');
    const { context, github } = contextWith();

    await runDeliver(context, deliverJob(), signal());

    expect(github.created[0]?.body).toContain(
      '_No decisions/ entry recorded for this change._',
    );
    expect(github.created[0]?.body).not.toContain(PR_ADR_TOKEN);
  });

  it('removes the todo file of its task in the same commit', async () => {
    commitOnBranch('todos/todo-1.md', '---\nstatus: todo\n---\n');
    commitOnBranch('wip-1.txt', 'one\n');
    const { context } = contextWith();

    await runDeliver(context, deliverJob(), signal());

    const files = filesOf(branchTip());
    expect(files).toContain('wip-1.txt');
    expect(files).not.toContain('todos/todo-1.md');
  });

  it('delivers an API-created order whose repo holds no todo file, and removes nothing', async () => {
    commitOnBranch('wip-1.txt', 'one\n');
    const { context, calls } = contextWith();

    await runDeliver(context, deliverJob(), signal());

    expect(reportsOf(calls)).toEqual([
      expect.objectContaining({ status: 'finished', commit: branchTip() }),
    ]);
    expect(filesOf(branchTip())).toContain('wip-1.txt');
  });

  it('delivers again onto the same branch and PR after a reopen', async () => {
    commitOnBranch('wip-1.txt', 'one\n');
    const first = contextWith();
    await runDeliver(first.context, deliverJob(), signal());
    const delivered = branchTip();
    commitOnBranch('rework.txt', 'rework\n');
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
    const tipBefore = commitOnBranch('wip-1.txt', 'one\n');
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

    expect(branchTip()).toBe(tipBefore);
    expect(github.created).toEqual([]);
    expect(reportsOf(calls)).toEqual([]);
  });

  it('reports a failed push and overwrites nothing when the remote moved', async () => {
    commitOnBranch('wip-1.txt', 'one\n');
    let moved = '';
    const movedOnDryRun: Answer = (sent) => {
      if (
        sent.request.command?.type === 'ReportDelivery' &&
        sent.request.dryRun === true
      ) {
        moved = commitOnBranch('pushed-by-someone-else.txt', 'theirs\n');
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
const stackedJob = (predecessor: string): Job => {
  const job = deliverJob({ branchBase: predecessor });
  return { ...job, repo: { ...job.repo, baseBranch: predecessor } } as Job;
};

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

describe('deliver job on a stacked base (CORE §12.5)', () => {
  it('delivers onto factory/<predecessor>: the PR targets it and the predecessor commit is an ancestor', async () => {
    const predTip = branchOnOrigin('factory/todo-0', baseHead, {
      'pred.txt': 'pred\n',
    });
    branchOnOrigin(BRANCH, predTip, {
      'todos/todo-1.md': '# todo\n',
      'wip.txt': 'wip\n',
    });
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
    branchOnOrigin(BRANCH, planTip, { 'wip.txt': 'wip\n' });
    const { context, github } = contextWith();

    await runDeliver(context, stackedJob('feat/xyz'), signal());

    const tip = branchTip();
    expect(git(origin, 'rev-parse', `${tip}^`)).toBe(planTip);
    expect(github.created).toEqual([
      expect.objectContaining({ branch: BRANCH, base: 'feat/xyz' }),
    ]);
  });

  it('reports delivery_failed and pushes nothing when the base branch is missing', async () => {
    const tipBefore = branchOnOrigin(BRANCH, baseHead, { 'wip.txt': 'wip\n' });
    const { context, calls, github } = contextWith();

    await runDeliver(context, stackedJob('factory/todo-gone'), signal());

    expect(branchTip()).toBe(tipBefore);
    expect(github.created).toEqual([]);
    const [report] = reportsOf(calls);
    expect(report).toMatchObject({ status: 'failed' });
    expect(String(report?.detail)).toMatch(/factory\/todo-gone/);
  });

  it('reports delivery_failed and pushes nothing when the predecessor was rewritten under the branch', async () => {
    const first = branchOnOrigin('factory/todo-0', baseHead, {
      'shared.txt': 'pred one\n',
    });
    const tipBefore = branchOnOrigin(BRANCH, first, {
      'shared.txt': 'work side\n',
    });
    // The predecessor is reopened and rewritten: the work commit no longer rebases cleanly.
    branchOnOrigin('factory/todo-0', baseHead, { 'shared.txt': 'pred two\n' });
    const { context, calls, github } = contextWith();

    await runDeliver(context, stackedJob('factory/todo-0'), signal());

    expect(branchTip()).toBe(tipBefore);
    expect(github.created).toEqual([]);
    const [report] = reportsOf(calls);
    expect(report).toMatchObject({ status: 'failed' });
    expect(String(report?.detail)).toMatch(/^rebase conflict/);
  });
});
