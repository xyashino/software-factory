import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FactoryClient } from '@repo/factory-core/contracts/client';
import { WireFailure } from '@repo/factory-core/contracts/errors';
import type { Job } from '@repo/factory-core/contracts/job';
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
import { commitFile, git, makeRepo } from '../testing/git-repo';

const CELL = '01J0000000000000000000000W' as CellId;
const JOB = '01J0000000000000000000000J' as JobId;
const ORDER = 'software-factory:todo-1' as OrderId;
const BRANCH = 'factory/todo-1';
const BODY = 'The body the factory rendered.';
const BODY_REF = `sha256:${'a'.repeat(64)}` as BlobRef;
const COMMIT_MESSAGE = 'feat: add the feature\n\nDelivered by the factory.';
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
let baseHead: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'factory-cell-deliver-'));
  origin = join(root, 'origin');
  baseHead = makeRepo(origin);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** The Factory's answers when everything is accepted: the blob holds the body, commands are accepted. */
const accepting: Answer = (sent) => {
  if (sent.route === 'blobGet') {
    return {
      ref: sent.request.ref,
      base64: Buffer.from(BODY).toString('base64'),
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
  }> = [];
  let pr = existing;
  const port: GithubPort = {
    findPr: async () => pr,
    createPr: async (input) => {
      created.push(input);
      pr = { number: 7, url: PR_URL, state: 'open' };
      return { url: PR_URL };
    },
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
      title: 'Add the feature',
      bodyBlob: BODY_REF,
      commitMessage: COMMIT_MESSAGE,
      removeTodo: 'todos/todo-1.md',
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
  it('delivers the work branch as one commit on the base, with the job message and a PR', async () => {
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
      {
        branch: BRANCH,
        base: 'main',
        title: 'Add the feature',
        body: BODY,
        draft: false,
      },
    ]);
    expect(reportsOf(calls)).toEqual([
      { status: 'finished', prUrl: PR_URL, commit: tip },
    ]);
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

  it('reuses the open PR of the branch and creates none', async () => {
    commitOnBranch('wip-1.txt', 'one\n');
    const existing: PrRef = {
      number: 3,
      url: 'https://example.test/pull/3',
      state: 'open',
    };
    const github = fakeGithub(existing);
    const { context, calls } = contextWith(accepting, github);

    await runDeliver(context, deliverJob(), signal());

    expect(github.created).toEqual([]);
    expect(reportsOf(calls)).toEqual([
      { status: 'finished', prUrl: existing.url, commit: branchTip() },
    ]);
  });

  it('takes the PR body from the blob, not the title', async () => {
    commitOnBranch('wip-1.txt', 'one\n');
    const { context, github } = contextWith();

    await runDeliver(context, deliverJob(), signal());

    expect(github.created[0]?.body).toBe(BODY);
    expect(github.created[0]?.body).not.toBe('Add the feature');
  });

  it('removes the todo file in the same commit', async () => {
    commitOnBranch('todos/todo-1.md', '---\nstatus: todo\n---\n');
    commitOnBranch('wip-1.txt', 'one\n');
    const { context } = contextWith();

    await runDeliver(context, deliverJob(), signal());

    const files = filesOf(branchTip());
    expect(files).toContain('wip-1.txt');
    expect(files).not.toContain('todos/todo-1.md');
  });

  it('still delivers when the todo file is already gone', async () => {
    commitOnBranch('wip-1.txt', 'one\n');
    const { context, calls } = contextWith();

    await runDeliver(context, deliverJob(), signal());

    expect(reportsOf(calls)).toEqual([
      expect.objectContaining({ status: 'finished', commit: branchTip() }),
    ]);
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

  it.each(['../outside.md', '/etc/outside.md'])(
    'refuses the todo path %s and pushes nothing',
    async (removeTodo) => {
      const tipBefore = commitOnBranch('wip-1.txt', 'one\n');
      const job = deliverJob();
      const unsafe = {
        ...job,
        deliver: { ...job.deliver, removeTodo },
      } as Job;
      const { context, calls, github } = contextWith(accepting);

      await runDeliver(context, unsafe, signal());

      expect(branchTip()).toBe(tipBefore);
      expect(github.created).toEqual([]);
      const [report] = reportsOf(calls);
      expect(report).toMatchObject({ status: 'failed' });
      expect(String(report?.detail)).toMatch(/^todo path/);
    },
  );

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
