import { describe, expect, it } from 'vitest';
import {
  resumeIdSchema,
  type CellId,
  type CommitSha,
  type CycleId,
  type JobId,
  type StationId,
} from '@repo/factory-core/ids';
import type { JobSpec } from '@repo/factory-core/order/next';
import type { WorkOrderState } from '@repo/factory-core/order/state';
import { fakeBlobStore } from '@repo/factory-core/testing';
import { buildJob, storeText } from '../job-builder';
import { DEFAULT_CONFIG } from '../ports';
import { PROJECT, REPO, shippedDefinitions } from './test-kit';

const COMMIT = 'c'.repeat(40) as CommitSha;
const JOB = '01J0000000000000000000000N' as JobId;
const CYCLE = '01J0000000000000000000000C' as CycleId;

/** Builds the job a spec names, for a Work order in the shipped `standard` Line, and returns its workspace. */
const workspaceFor = async (
  spec: JobSpec,
  overrides: Partial<WorkOrderState> = {},
  andon?: WorkOrderState['andon'],
) => {
  const blobs = fakeBlobStore();
  const defs = shippedDefinitions();
  const line = defs.lines.get('standard')!.snapshot;
  const state = {
    orderId: `${PROJECT}:fix-ci`,
    projectId: PROJECT,
    todoId: 'fix-ci',
    baseBranch: 'main',
    dependsOn: [],
    line,
    spec: {
      title: 'fix-ci: Fix CI',
      type: 'fix',
      bodyBlob: await storeText(blobs, '# Fix CI', 'text/markdown'),
    },
    activeJob: {
      jobId: JOB,
      kind: spec.kind,
      cellId: 'cell' as CellId,
      epoch: 1,
      cycleId: CYCLE,
    },
    andon,
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
    ...overrides,
  } as unknown as WorkOrderState;
  const job = await buildJob(
    { blobs, runtimePrompts: defs.runtimePrompts, config: DEFAULT_CONFIG },
    state,
    {
      projectId: PROJECT,
      repoUrl: REPO,
      baseBranch: 'main',
      maxRunning: 2,
      depPolicy: 'delivered',
    },
    spec,
  );
  return job.workspace;
};

const RESUME = resumeIdSchema.parse('01J0000000000000000000000R');

const firstStation = (): StationId =>
  shippedDefinitions().lines.get('standard')!.snapshot.stations[0]!.id;

describe('the worktree mode of a job (PROTOCOL §9)', () => {
  it('places the worktree fresh for Station 0 from the branch base', async () => {
    const workspace = await workspaceFor({
      kind: 'run_operator_station',
      stationId: firstStation(),
      n: 1,
      cause: { kind: 'first' },
      base: 'branch_base',
    });

    expect(workspace?.mode).toBe('fresh');
  });

  it('reuses the worktree of a later Station, keeping the work of earlier Stations', async () => {
    const later =
      shippedDefinitions().lines.get('standard')!.snapshot.stations[1]!;
    const workspace = await workspaceFor({
      kind:
        later.kind === 'inspection' ? 'run_inspection' : 'run_operator_station',
      stationId: later.id,
      n: 1,
      cause: { kind: 'first' },
      base: COMMIT,
    } as JobSpec);

    expect(workspace?.mode).toBe('reuse');
  });

  it('places a resumed job fresh when the Supervisor named its base commit', async () => {
    const workspace = await workspaceFor(
      {
        kind: 'run_operator_station',
        stationId: firstStation(),
        n: 2,
        cause: { kind: 'resume', resumeId: RESUME },
        base: COMMIT,
      },
      {
        pendingResume: {
          resumeId: RESUME,
          forStation: firstStation(),
          baseCommit: COMMIT,
        },
      },
    );

    expect(workspace?.mode).toBe('fresh');
  });

  it('reuses the worktree for a delivery', async () => {
    const workspace = await workspaceFor({
      kind: 'deliver',
      base: COMMIT,
    });

    expect(workspace?.mode).toBe('reuse');
  });

  it('keeps the work of earlier Stations for a Mechanic that triages a non-workspace Andon', async () => {
    const workspace = await workspaceFor(
      { kind: 'mechanic', andonAt: 2000, n: 1 },
      {},
      {
        reason: 'delivery_failed',
        detail: 'pre-commit failed',
        at: 2000,
        triage: 'mechanic',
      },
    );

    expect(workspace?.mode).toBe('reuse');
  });

  it('places the worktree fresh for a Mechanic that repairs a workspace failure', async () => {
    const workspace = await workspaceFor(
      { kind: 'mechanic', andonAt: 2000, n: 1 },
      {},
      {
        reason: 'workspace_failed',
        detail: 'worktree broke',
        at: 2000,
        triage: 'mechanic',
      },
    );

    expect(workspace?.mode).toBe('fresh');
  });
});
