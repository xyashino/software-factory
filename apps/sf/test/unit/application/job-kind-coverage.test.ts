import { describe, expect, it } from 'vitest';
import { JOB_KINDS } from '@repo/hq-contracts/enums/jobs';
import type { Ports } from '../../../src/application/core/procedure';
import type {
  CellRuntime,
  ClaimedJob,
} from '../../../src/application/procedures/cell/cell-runtime';
import { runJob } from '../../../src/application/procedures/cell/run-job.procedure';
import { createFakePorts } from '../../support/fake-ports';

const UNHANDLED_MARKERS = [
  'job names no valid line',
  'unknown job kind',
] as const;

const jobOf = (kind: string): ClaimedJob => ({
  jobId: `job-${kind}`,
  kind,
  orderId: null,
  planId: 'proj-1:feature-plan',
  stepId: null,
  workspaceMode: 'fresh',
  epoch: 1,
  leaseExpiresAt: 0,
  repoUrl: 'git@example.test:repo.git',
  baseBranch: 'main',
  baseCommitSha: null,
  headCommitSha: null,
  targetBranch: 'feat/feature',
  expectedPriorSteps: [],
  payload: { planId: 'proj-1:feature-plan', lineName: 'feature' },
});

const runtimeOf = (ports: Ports): CellRuntime => ({
  ports,
  session: { cellId: 'cell-1', sessionToken: 'session-token' },
  projectId: 'proj-1',
  repoRoot: '/repo',
  signal: new AbortController().signal,
});

const outcomeOf = async (kind: string): Promise<string> => {
  const fake = createFakePorts({ reply: () => ({ code: 200 }) });
  const ports: Ports = {
    ...fake.ports,
    process: {
      ...fake.ports.process,
      run: async () => ({ exitCode: 0, stdout: 'main-sha\n', stderr: '' }),
    },
  };
  try {
    await runJob(runtimeOf(ports), jobOf(kind));
  } catch {
    // Bare fake replies do not satisfy every transition schema; the
    // requests sent before that point still show what the job was told.
  }
  return JSON.stringify(fake.calls.map((call) => call.body ?? null));
};

describe('job kind coverage', () => {
  it('runs every job kind HQ can create', async () => {
    const unhandled: string[] = [];
    for (const kind of JOB_KINDS) {
      const outcome = await outcomeOf(kind);
      if (UNHANDLED_MARKERS.some((marker) => outcome.includes(marker))) {
        unhandled.push(kind);
      }
    }

    expect(unhandled).toEqual([]);
  });
});
