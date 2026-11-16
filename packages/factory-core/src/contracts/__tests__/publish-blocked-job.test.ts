import { describe, expect, it } from 'vitest';
import { jobSchema } from '../job';

const JOB_ID = '01J0000000000000000000000J';
const ORDER_ID = 'software-factory:todo-a';

/** The job without one of its keys. */
const without = (job: Record<string, unknown>, key: string) =>
  Object.fromEntries(Object.entries(job).filter(([name]) => name !== key));

/** A blocked publish: an OrderId, a reused workspace and a `blocked` block, no station. */
const publishJob = {
  jobId: JOB_ID,
  orderId: ORDER_ID,
  projectId: 'software-factory',
  epoch: 1,
  kind: 'publish_blocked',
  repo: {
    url: 'https://example.test/sf.git',
    baseBranch: 'main',
    branch: 'factory/todo-a',
  },
  base: { branchBase: 'main' },
  workspace: {
    dir: 'todo-a',
    sync: [],
    setup: [],
    timeoutMs: 600_000,
    mode: 'reuse',
  },
  blocked: {
    taskId: 'todo-a',
    reason: 'cycle_blocked',
    detail: 'cycle is blocked',
    logCommand: `factory log ${ORDER_ID}`,
  },
};

describe('publish_blocked job contract', () => {
  it('accepts a blocked publish with a reused workspace and a blocked block', () => {
    expect(jobSchema.safeParse(publishJob).success).toBe(true);
  });

  it('needs the blocked block', () => {
    expect(jobSchema.safeParse(without(publishJob, 'blocked')).success).toBe(
      false,
    );
  });

  it('needs a workspace, since the publish works on the worktree', () => {
    expect(jobSchema.safeParse(without(publishJob, 'workspace')).success).toBe(
      false,
    );
  });

  it('has no station, and a station job refuses a blocked block', () => {
    const withStation = {
      ...publishJob,
      station: {
        stationId: 'plan',
        cycleId: '01J0000000000000000000000C',
        n: 1,
        cause: { kind: 'first' },
      },
    };
    expect(jobSchema.safeParse(withStation).success).toBe(false);

    const stationJob = {
      ...publishJob,
      kind: 'run_inspection',
      station: {
        stationId: 'plan',
        cycleId: '01J0000000000000000000000C',
        n: 1,
        cause: { kind: 'first' },
      },
    };
    expect(jobSchema.safeParse(stationJob).success).toBe(false);
  });

  it('is not a delivery', () => {
    expect(
      jobSchema.safeParse({ ...publishJob, deliver: { taskId: 'x' } }).success,
    ).toBe(false);
  });
});
