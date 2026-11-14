import { describe, expect, it } from 'vitest';
import { jobSchema } from '../job';

const JOB_ID = '01J0000000000000000000000J';
const ORDER_ID = 'software-factory:todo-a';
const PLAN_ID = 'software-factory:plan:feat-x';
const BLOB = `sha256:${'b'.repeat(64)}`;

const workJob = {
  jobId: JOB_ID,
  orderId: ORDER_ID,
  projectId: 'software-factory',
  epoch: 1,
  kind: 'run_operator_station',
  repo: {
    url: 'https://example.test/sf.git',
    baseBranch: 'main',
    branch: 'factory/todo-a',
  },
  base: { branchBase: 'main' },
  workspace: { dir: 'todo-a', sync: [], setup: [], timeoutMs: 600_000 },
  station: {
    stationId: 'plan',
    cycleId: '01J0000000000000000000000C',
    n: 1,
    cause: { kind: 'first' },
  },
};

/** A plan job: a PlanId, a `plan` block, no workspace. */
const planJob = (kind: string, plan: Record<string, unknown> = {}) => ({
  jobId: JOB_ID,
  orderId: PLAN_ID,
  projectId: 'software-factory',
  epoch: 1,
  kind,
  repo: {
    url: 'https://example.test/sf.git',
    baseBranch: 'main',
    branch: 'feat/x',
  },
  base: { branchBase: 'main' },
  plan: { slug: 'x', title: 'Plan x', ...plan },
});

describe('Job contract: Order Plan jobs (PROTOCOL §4)', () => {
  it.each(['plan_branch', 'plan_pr'])('accepts a %s job', (kind) => {
    expect(jobSchema.safeParse(planJob(kind)).success).toBe(true);
  });

  it('accepts plan_pr_ready once the plan PR url is known', () => {
    const job = planJob('plan_pr_ready', {
      prUrl: 'https://example.test/pull/9',
      bodyBlob: BLOB,
    });
    expect(jobSchema.safeParse(job).success).toBe(true);
  });

  it('rejects plan_pr_ready without plan.prUrl', () => {
    expect(jobSchema.safeParse(planJob('plan_pr_ready')).success).toBe(false);
  });

  it('rejects a plan kind without a plan block', () => {
    const bare = { ...planJob('plan_branch'), plan: undefined };
    expect(jobSchema.safeParse(bare).success).toBe(false);
  });

  it.each([
    ['workspace', { workspace: workJob.workspace }],
    ['station', { station: workJob.station }],
    [
      'deliver',
      {
        deliver: {
          title: 't',
          bodyBlob: BLOB,
          commitMessage: 'm',
          removeTodo: 'todos/a.md',
        },
      },
    ],
  ])('rejects a plan kind that carries %s', (_label, extra) => {
    const job = { ...planJob('plan_branch'), ...extra };
    expect(jobSchema.safeParse(job).success).toBe(false);
  });

  it('accepts a PlanId as the orderId of a plan job', () => {
    expect(jobSchema.safeParse(planJob('plan_pr')).success).toBe(true);
  });

  it('rejects a plan kind whose orderId is an OrderId', () => {
    const job = { ...planJob('plan_pr'), orderId: ORDER_ID };
    expect(jobSchema.safeParse(job).success).toBe(false);
  });

  it('rejects a work kind whose orderId is a PlanId', () => {
    const job = { ...workJob, orderId: PLAN_ID };
    expect(jobSchema.safeParse(job).success).toBe(false);
  });
});

describe('Job contract: Work order jobs keep their shape', () => {
  it('accepts a station job with its workspace', () => {
    expect(jobSchema.safeParse(workJob).success).toBe(true);
  });

  it('rejects a station job without a workspace', () => {
    const bare = { ...workJob, workspace: undefined };
    expect(jobSchema.safeParse(bare).success).toBe(false);
  });

  it('rejects a station job without a station', () => {
    const bare = { ...workJob, station: undefined };
    expect(jobSchema.safeParse(bare).success).toBe(false);
  });

  it('accepts a deliver job with its deliver block', () => {
    const job = {
      ...workJob,
      kind: 'deliver',
      station: undefined,
      deliver: {
        title: 'Add it',
        bodyBlob: BLOB,
        commitMessage: 'Add it',
        removeTodo: 'todos/todo-a.md',
      },
    };
    expect(jobSchema.safeParse(job).success).toBe(true);
  });

  it('rejects a deliver job without a deliver block', () => {
    const job = { ...workJob, kind: 'deliver', station: undefined };
    expect(jobSchema.safeParse(job).success).toBe(false);
  });

  it('rejects a work job that carries a plan block', () => {
    const job = {
      ...workJob,
      plan: { slug: 'x', title: 'Plan x' },
    };
    expect(jobSchema.safeParse(job).success).toBe(false);
  });
});
