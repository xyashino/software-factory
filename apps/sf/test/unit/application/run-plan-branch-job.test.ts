import { describe, expect, it } from 'vitest';
import type { Ports } from '../../../src/application/core/procedure';
import type {
  CellRuntime,
  ClaimedJob,
} from '../../../src/application/procedures/cell/cell-runtime';
import { runJob } from '../../../src/application/procedures/cell/run-job.procedure';
import { createFakePorts } from '../../support/fake-ports';

const PLAN_BASE_SHA = 'main-sha';
const JOB: ClaimedJob = {
  jobId: 'job-plan',
  kind: 'plan_branch',
  orderId: null,
  planId: 'proj-1:standalone-factory',
  stepId: null,
  workspaceMode: 'fresh',
  epoch: 1,
  leaseExpiresAt: 0,
  repoUrl: 'git@example.test:repo.git',
  baseBranch: 'main',
  baseCommitSha: null,
  headCommitSha: null,
  targetBranch: 'feat/standalone-factory',
  expectedPriorSteps: [],
  payload: { planId: 'proj-1:standalone-factory' },
};

const reply = (body: unknown) => {
  const action = (body as { action: string }).action;
  if (action === 'complete')
    return { code: 200, action, completed: true, nextJob: null };
  if (action === 'fail')
    return { code: 200, action, failed: true, nextJob: JOB };
  return { code: 200, action: 'start', status: 'running' };
};

const harness = (pushExit: number, remoteSha = '') => {
  const git: string[][] = [];
  const fake = createFakePorts({
    reply: (call) =>
      call.route.endsWith('/transitions') ? reply(call.body) : { code: 200 },
  });
  const ports: Ports = {
    ...fake.ports,
    process: {
      ...fake.ports.process,
      run: async (command, args) => {
        git.push([command, ...args]);
        const exitCode = args[0] === 'push' ? pushExit : 0;
        const stdout =
          args[0] === 'rev-parse'
            ? `${PLAN_BASE_SHA}\n`
            : args[0] === 'ls-remote' && remoteSha !== ''
              ? `${remoteSha}\trefs/heads/feat/standalone-factory\n`
              : '';
        return { exitCode, stdout, stderr: exitCode === 0 ? '' : 'rejected' };
      },
    },
  };
  const runtime: CellRuntime = {
    ports,
    session: { cellId: 'cell-1', sessionToken: 'session-token' },
    projectId: 'proj-1',
    repoRoot: '/repo',
    signal: new AbortController().signal,
  };
  return { runtime, git, calls: fake.calls };
};

const transitionsOf = (calls: { route: string; body?: unknown }[]) =>
  calls
    .filter((call) => call.route.endsWith('/transitions'))
    .map((call) => call.body as { action: string; commitSha?: string });

describe('plan branch job', () => {
  it('publishes the plan branch from the base branch and completes with its commit', async () => {
    const h = harness(0);

    await runJob(h.runtime, JOB);

    expect(h.git).toEqual([
      ['git', 'fetch', 'origin', 'main'],
      ['git', 'rev-parse', 'FETCH_HEAD'],
      [
        'git',
        'push',
        'origin',
        `${PLAN_BASE_SHA}:refs/heads/feat/standalone-factory`,
      ],
    ]);
    expect(transitionsOf(h.calls)).toEqual([
      expect.objectContaining({ action: 'start' }),
      expect.objectContaining({
        action: 'complete',
        commitSha: PLAN_BASE_SHA,
      }),
    ]);
  });

  it('force-updates an existing plan branch under a lease on the remote commit when reset', async () => {
    const h = harness(0, 'old-plan-sha');

    await runJob(h.runtime, {
      ...JOB,
      payload: { planId: JOB.payload.planId, fresh: true },
    });

    expect(h.git).toContainEqual([
      'git',
      'push',
      '--force-with-lease=refs/heads/feat/standalone-factory:old-plan-sha',
      'origin',
      `${PLAN_BASE_SHA}:refs/heads/feat/standalone-factory`,
    ]);
    expect(transitionsOf(h.calls).at(-1)).toMatchObject({
      action: 'complete',
      commitSha: PLAN_BASE_SHA,
    });
  });

  it('fails the job with the git error when the push is rejected', async () => {
    const h = harness(1);

    await runJob(h.runtime, JOB);

    expect(transitionsOf(h.calls).at(-1)).toMatchObject({
      action: 'fail',
      detail: expect.stringContaining('plan branch failed'),
    });
  });
});
