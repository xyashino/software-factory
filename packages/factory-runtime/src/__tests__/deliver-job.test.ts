import { describe, expect, it } from 'vitest';
import type { CellId, CommitSha, JobId } from '@repo/factory-core/ids';
import type { WorkOrderState } from '@repo/factory-core/order/state';
import { fakeBlobStore } from '@repo/factory-core/testing';
import { buildJob, storeText } from '../job-builder';
import { DEFAULT_CONFIG } from '../ports';
import { PROJECT, REPO, shippedDefinitions } from './test-kit';

const COMMIT = 'c'.repeat(40) as CommitSha;
const JOB = '01J0000000000000000000000N' as JobId;

const buildDeliverFor = async (
  lineName: 'feature' | 'standard' | 'fast',
  requireAdrOverride?: boolean,
) => {
  const blobs = fakeBlobStore();
  const defs = shippedDefinitions();
  const snapshot = defs.lines.get(lineName)!.snapshot;
  const line =
    requireAdrOverride === undefined
      ? snapshot
      : {
          ...snapshot,
          deliver: { ...snapshot.deliver!, requireAdr: requireAdrOverride },
        };
  const state = {
    orderId: `${PROJECT}:todo-1`,
    projectId: PROJECT,
    todoId: 'todo-1',
    baseBranch: 'main',
    dependsOn: [],
    line,
    spec: {
      title: 'todo-1: Add gate',
      type: 'feat',
      bodyBlob: await storeText(blobs, '# Add gate', 'text/markdown'),
    },
    activeJob: {
      jobId: JOB,
      kind: 'deliver',
      cellId: 'cell' as CellId,
      epoch: 1,
    },
    cycles: [],
    lastPassed: {},
    retriesUsed: {},
    retryGrants: {},
    restartsUsed: {},
    lostRestartsUsed: {},
    notes: [],
    questions: [],
    recovered: [],
    incidents: [],
    workspaceFailures: [],
  } as unknown as WorkOrderState;

  return buildJob(
    { blobs, runtimePrompts: defs.runtimePrompts, config: DEFAULT_CONFIG },
    state,
    {
      projectId: PROJECT,
      repoUrl: REPO,
      baseBranch: 'main',
      maxRunning: 2,
      depPolicy: 'delivered',
    },
    { kind: 'deliver', base: COMMIT },
  );
};

describe('buildJob for deliver', () => {
  it('propagates requireAdr when the line sets it', async () => {
    const featureJob = await buildDeliverFor('feature');
    const standardJob = await buildDeliverFor('standard');

    expect(featureJob.deliver?.requireAdr).toBe(true);
    expect(standardJob.deliver?.requireAdr).toBe(true);
  });

  it('omits requireAdr when the line leaves it unset and preserves explicit false', async () => {
    const fastJob = await buildDeliverFor('fast');
    const disabledJob = await buildDeliverFor('feature', false);

    expect(fastJob.deliver).not.toHaveProperty('requireAdr');
    expect(disabledJob.deliver?.requireAdr).toBe(false);
  });
});
