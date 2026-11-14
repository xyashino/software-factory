import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FactoryClient } from '@repo/factory-core/contracts/client';
import { WireFailure } from '@repo/factory-core/contracts/errors';
import type { Job } from '@repo/factory-core/contracts/job';
import type { BlobRef, CellId, JobId, PlanId } from '@repo/factory-core/ids';
import { createSystemAdapter } from '../adapters/system/system.adapter';
import { runPlanJob } from '../jobs/plan';
import { JobStopped, type JobContext } from '../jobs/send';
import { fakeGithub, type FakeGithub } from '../testing/fake-github';
import { commitFile, git, makeRepo } from '../testing/git-repo';
import { mirrorPathOf } from '../workspace/mirror';

const CELL = '01J0000000000000000000000W' as CellId;
const JOB = '01J0000000000000000000000J' as JobId;
const JOB2 = '01J0000000000000000000000K' as JobId;
const PLAN = 'software-factory:plan:xyz' as PlanId;
const BRANCH = 'feat/xyz';
const BODY = 'Sub-PRs: wo-1 (no PR yet)';
const BODY_REF = `sha256:${'c'.repeat(64)}` as BlobRef;
const PR_URL = 'https://example.test/software-factory/pull/21';

let root: string;
let origin: string;
let baseHead: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'factory-cell-plan-'));
  origin = join(root, 'origin');
  baseHead = makeRepo(origin);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** One call the job made: the route and the request it sent. */
interface Sent {
  route: string;
  request: {
    command?: { type: string } & Record<string, unknown>;
    commandId?: string;
    dryRun?: boolean;
    ref?: string;
  };
}

type Answer = (sent: Sent) => unknown;

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

/** A context whose client records every call and answers from `answer`. */
const contextWith = (
  answer: Answer = accepting,
  github: FakeGithub = fakeGithub(),
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
    cellDataDir: join(root, 'cell'),
    worktreeLimit: 8,
    inUse: new Set(),
    githubFor: () => github,
  };
  return { context, calls, github };
};

/** A plan job on the origin repo. `kind` and the plan block vary; there is no workspace. */
const planJob = (
  kind: Job['kind'],
  overrides: {
    epoch?: number;
    jobId?: JobId;
    plan?: Record<string, unknown>;
    baseBranch?: string;
  } = {},
): Job =>
  ({
    jobId: overrides.jobId ?? JOB,
    orderId: PLAN,
    projectId: 'software-factory',
    epoch: overrides.epoch ?? 1,
    kind,
    repo: {
      url: origin,
      baseBranch: overrides.baseBranch ?? 'main',
      branch: BRANCH,
    },
    base: { branchBase: overrides.baseBranch ?? 'main' },
    plan: {
      slug: 'xyz',
      title: 'Order Plan xyz',
      bodyBlob: BODY_REF,
      ...overrides.plan,
    },
  }) as unknown as Job;

const signal = (): AbortSignal => new AbortController().signal;

/** The sha `ref` names on origin, or the empty string when it does not exist. */
const refOnOrigin = (ref: string): string => {
  const listed = git(origin, 'for-each-ref', '--format=%(objectname)', ref);
  return listed;
};

/** Makes or moves `name` on origin to `from` plus one commit. Returns the new tip. */
const branchOnOrigin = (name: string, from: string, file: string): string => {
  git(origin, 'checkout', '-q', '-B', name, from);
  const tip = commitFile(origin, file, `${file}\n`);
  git(origin, 'checkout', '-q', 'main');
  return tip;
};

/** The results of the real (not dry-run) plan reports, in order. */
const reportsOf = (calls: Sent[]) =>
  calls
    .filter(
      (call) => call.route === 'submitCommand' && call.request.dryRun !== true,
    )
    .map((call) => call.request.command);

describe('plan_branch (PROTOCOL §4, CORE §12.5)', () => {
  it('creates feat/<slug> at the base sha on the remote, reporting it, without force', async () => {
    const { context, calls } = contextWith();

    await runPlanJob(context, planJob('plan_branch'), signal());

    expect(refOnOrigin(`refs/heads/${BRANCH}`)).toBe(baseHead);
    expect(reportsOf(calls)).toEqual([
      { type: 'ReportPlanBranch', commit: baseHead },
    ]);
  });

  it('reports the tip of a branch that is present, and pushes nothing', async () => {
    const tip = branchOnOrigin(BRANCH, baseHead, 'advanced.txt');
    const { context, calls } = contextWith();

    await runPlanJob(context, planJob('plan_branch'), signal());

    expect(refOnOrigin(`refs/heads/${BRANCH}`)).toBe(tip);
    expect(reportsOf(calls)).toEqual([
      { type: 'ReportPlanBranch', commit: tip },
    ]);
  });

  it('a run twice, then a takeover under a new epoch, leaves one feat/<slug> at the same commit', async () => {
    const first = contextWith();
    await runPlanJob(first.context, planJob('plan_branch'), signal());
    const created = refOnOrigin(`refs/heads/${BRANCH}`);

    const second = contextWith();
    await runPlanJob(
      second.context,
      planJob('plan_branch', { epoch: 2, jobId: JOB2 }),
      signal(),
    );

    expect(
      git(
        origin,
        'for-each-ref',
        '--format=%(refname)',
        'refs/heads/feat',
      ).split('\n'),
    ).toEqual([`refs/heads/${BRANCH}`]);
    expect(refOnOrigin(`refs/heads/${BRANCH}`)).toBe(created);
    expect(reportsOf(second.calls)).toEqual([
      { type: 'ReportPlanBranch', commit: created },
    ]);
  });

  it('accepts the race where the branch appears at the same base before the push', async () => {
    const racing: Answer = (sent) => {
      if (sent.request.dryRun === true) {
        git(origin, 'branch', BRANCH, baseHead);
      }
      return accepting(sent);
    };
    const { context, calls } = contextWith(racing);

    await runPlanJob(context, planJob('plan_branch'), signal());

    expect(refOnOrigin(`refs/heads/${BRANCH}`)).toBe(baseHead);
    expect(reportsOf(calls)).toEqual([
      { type: 'ReportPlanBranch', commit: baseHead },
    ]);
  });

  it('accepts the race where the branch appears above the base, and reports its tip', async () => {
    let tip = '';
    const racing: Answer = (sent) => {
      if (sent.request.dryRun === true) {
        tip = branchOnOrigin(BRANCH, baseHead, 'raced.txt');
      }
      return accepting(sent);
    };
    const { context, calls } = contextWith(racing);

    await runPlanJob(context, planJob('plan_branch'), signal());

    expect(refOnOrigin(`refs/heads/${BRANCH}`)).toBe(tip);
    expect(reportsOf(calls)).toEqual([
      { type: 'ReportPlanBranch', commit: tip },
    ]);
  });

  it('reports ReportPlanJobFailed when the branch appears at another base before the push', async () => {
    const racing: Answer = (sent) => {
      if (sent.request.dryRun === true) {
        git(origin, 'checkout', '-q', '--orphan', 'unrelated');
        const orphan = commitFile(origin, 'orphan.txt', 'orphan\n');
        git(origin, 'branch', '-f', BRANCH, orphan);
        git(origin, 'checkout', '-q', 'main');
      }
      return accepting(sent);
    };
    const { context, calls } = contextWith(racing);

    await runPlanJob(context, planJob('plan_branch'), signal());

    const [report] = reportsOf(calls);
    expect(report).toMatchObject({ type: 'ReportPlanJobFailed' });
    expect(String(report?.detail)).toMatch(/^push refused/);
  });

  it('a stale epoch on the dry run stops the job, and nothing is pushed', async () => {
    const stale: Answer = (sent) => {
      if (sent.request.dryRun === true) {
        throw new WireFailure({ code: 'stale_epoch', current: 9 });
      }
      return accepting(sent);
    };
    const { context } = contextWith(stale);

    await expect(
      runPlanJob(context, planJob('plan_branch'), signal()),
    ).rejects.toBeInstanceOf(JobStopped);
    expect(refOnOrigin('refs/heads/feat')).toBe('');
  });

  it('a missing base branch reports ReportPlanJobFailed and pushes nothing', async () => {
    const { context, calls } = contextWith();

    await runPlanJob(
      context,
      planJob('plan_branch', { baseBranch: 'release/9' }),
      signal(),
    );

    expect(refOnOrigin('refs/heads/feat')).toBe('');
    const [report] = reportsOf(calls);
    expect(report).toMatchObject({ type: 'ReportPlanJobFailed' });
    expect(String(report?.detail)).toMatch(/release\/9/);
  });

  it('a fetch failure reports ReportPlanJobFailed with the fetch stage', async () => {
    const { context, calls } = contextWith();
    const broken = {
      ...planJob('plan_branch'),
      repo: {
        url: join(root, 'missing.git'),
        baseBranch: 'main',
        branch: BRANCH,
      },
    } as Job;

    await runPlanJob(context, broken, signal());

    const [report] = reportsOf(calls);
    expect(report).toMatchObject({ type: 'ReportPlanJobFailed' });
    expect(String(report?.detail)).toMatch(/^fetch:/);
  });
});

describe('plan_pr (PROTOCOL §4, CORE §12.5)', () => {
  it('opens the draft plan PR once; a second run finds it and opens none', async () => {
    const first = contextWith();
    await runPlanJob(first.context, planJob('plan_pr'), signal());

    expect(first.github.created).toEqual([
      {
        branch: BRANCH,
        base: 'main',
        title: 'Order Plan xyz',
        body: BODY,
        draft: true,
      },
    ]);
    expect(reportsOf(first.calls)).toEqual([
      { type: 'ReportPlanPr', prUrl: first.github.prs[0]?.url },
    ]);

    const second = contextWith(accepting, first.github);
    await runPlanJob(
      second.context,
      planJob('plan_pr', { epoch: 2, jobId: JOB2 }),
      signal(),
    );

    expect(first.github.created).toHaveLength(1);
    expect(reportsOf(second.calls)).toEqual([
      { type: 'ReportPlanPr', prUrl: first.github.prs[0]?.url },
    ]);
  });

  it('finds a pre-seeded merged PR and reports it, opening nothing', async () => {
    const github = fakeGithub();
    github.seed({
      url: PR_URL,
      state: 'merged',
      draft: false,
      head: BRANCH,
      base: 'main',
    });
    const { context, calls } = contextWith(accepting, github);

    await runPlanJob(context, planJob('plan_pr'), signal());

    expect(github.created).toEqual([]);
    expect(reportsOf(calls)).toEqual([{ type: 'ReportPlanPr', prUrl: PR_URL }]);
  });
});

describe('plan_pr_ready (PROTOCOL §4, CORE §12.5)', () => {
  const readyJob = (epoch = 1, jobId: JobId = JOB) =>
    planJob('plan_pr_ready', { epoch, jobId, plan: { prUrl: PR_URL } });

  it('marks the PR ready once and writes the body; a second run is a no-op on GitHub', async () => {
    const github = fakeGithub();
    github.seed({
      url: PR_URL,
      state: 'open',
      draft: true,
      head: BRANCH,
      base: 'main',
    });

    const first = contextWith(accepting, github);
    await runPlanJob(first.context, readyJob(), signal());
    expect(github.readied).toEqual([PR_URL]);
    expect(github.bodies.get(PR_URL)).toBe(BODY);
    expect(reportsOf(first.calls)).toEqual([{ type: 'ReportPlanReady' }]);

    const second = contextWith(accepting, github);
    await runPlanJob(second.context, readyJob(2, JOB2), signal());
    expect(github.readied).toEqual([PR_URL]);
    expect(reportsOf(second.calls)).toEqual([{ type: 'ReportPlanReady' }]);
  });

  it('a stale epoch on the dry run stops the job before GitHub is touched', async () => {
    const github = fakeGithub();
    github.seed({
      url: PR_URL,
      state: 'open',
      draft: true,
      head: BRANCH,
      base: 'main',
    });
    const stale: Answer = (sent) => {
      if (sent.request.dryRun === true)
        throw new WireFailure({ code: 'stale_epoch', current: 9 });
      return accepting(sent);
    };
    const { context } = contextWith(stale, github);

    await expect(
      runPlanJob(context, readyJob(), signal()),
    ).rejects.toBeInstanceOf(JobStopped);
    expect(github.readied).toEqual([]);
    expect(github.bodies.size).toBe(0);
  });
});

describe('plan jobs never make a worktree (PROTOCOL §4)', () => {
  it('leaves no worktree directory behind for any plan kind', async () => {
    const github = fakeGithub();
    github.seed({
      url: PR_URL,
      state: 'open',
      draft: true,
      head: BRANCH,
      base: 'main',
    });
    const { context } = contextWith(accepting, github);

    await runPlanJob(context, planJob('plan_branch'), signal());
    await runPlanJob(context, planJob('plan_pr'), signal());
    await runPlanJob(
      context,
      planJob('plan_pr_ready', { plan: { prUrl: PR_URL } }),
      signal(),
    );

    expect(existsSync(join(root, 'cell', 'worktrees'))).toBe(false);
    expect(existsSync(mirrorPathOf(join(root, 'cell'), origin))).toBe(true);
  });
});
