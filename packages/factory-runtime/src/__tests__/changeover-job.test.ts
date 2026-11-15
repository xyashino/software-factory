import { describe, expect, it } from 'vitest';
import type {
  CellId,
  CommitSha,
  JobId,
  StationId,
} from '@repo/factory-core/ids';
import type { LineSnapshot } from '@repo/factory-core/line/snapshot';
import type { WorkOrderState } from '@repo/factory-core/order/state';
import { fakeBlobStore } from '@repo/factory-core/testing';
import { buildJob, storeText } from '../job-builder';
import { DEFAULT_CONFIG } from '../ports';
import { PROJECT, REPO, shippedDefinitions } from './test-kit';

const COMMIT = 'c'.repeat(40) as CommitSha;
const CYCLE = '01J0000000000000000000000C';
const JOB = '01J0000000000000000000000J' as JobId;
const CELL = 'cell-a' as CellId;
const PROJECT_RECORD = {
  projectId: PROJECT,
  repoUrl: REPO,
  baseBranch: 'main',
  maxRunning: 2,
  depPolicy: 'delivered' as const,
};

/** The shipped feature Line, as a snapshot a Work order pins. */
const featureLine = (): LineSnapshot =>
  shippedDefinitions().lines.get('feature')!.snapshot;

/** The Work order state a claimed job of `line` runs in. */
const stateOf = async (
  line: LineSnapshot,
  blobs: ReturnType<typeof fakeBlobStore>,
): Promise<WorkOrderState> =>
  ({
    orderId: `${PROJECT}:feat-x`,
    projectId: PROJECT,
    todoId: 'feat-x',
    baseBranch: 'main',
    dependsOn: [],
    line,
    spec: {
      title: 'feat-x: X',
      type: 'feat',
      bodyBlob: await storeText(blobs, '# X', 'text/markdown'),
    },
    activeJob: { jobId: JOB, epoch: 1, cycleId: CYCLE, cellId: CELL },
    checkpoint: { commit: COMMIT, afterStation: 'build' },
    cycles: [],
    retriesUsed: {},
  }) as unknown as WorkOrderState;

/** Builds the Job of a spec against a line, with the shipped runtime prompts. */
const jobOf = async (
  line: LineSnapshot,
  spec: Parameters<typeof buildJob>[3],
) => {
  const blobs = fakeBlobStore();
  const defs = shippedDefinitions();
  return buildJob(
    { blobs, runtimePrompts: defs.runtimePrompts, config: DEFAULT_CONFIG },
    await stateOf(line, blobs),
    PROJECT_RECORD,
    spec,
  );
};

const inspection = {
  kind: 'run_inspection' as const,
  stationId: 'quality-gate' as StationId,
  n: 1,
  cause: { kind: 'first' as const },
  base: COMMIT,
};

describe('buildJob resolves the changeover from the pinned Line', () => {
  it('gives an inspection the line changeover: its commands, key files and timeout', async () => {
    const job = await jobOf(featureLine(), inspection);
    expect(job.workspace).toMatchObject({
      dir: 'feat-x',
      changeover: ['pnpm install --frozen-lockfile'],
      changeoverKeyFiles: [
        'pnpm-lock.yaml',
        'pnpm-workspace.yaml',
        '**/package.json',
      ],
      timeoutMs: 600_000,
    });
  });

  it('gives a delivery no changeover when the line opts it out, with no key files or timeout', async () => {
    const job = await jobOf(featureLine(), { kind: 'deliver', base: COMMIT });
    expect(job.kind).toBe('deliver');
    expect(job.workspace?.changeover).toEqual([]);
    expect(job.workspace).not.toHaveProperty('changeoverKeyFiles');
    expect(job.workspace).not.toHaveProperty('timeoutMs');
  });

  it('gives a Job no changeover when the line declares none', async () => {
    const line = featureLine();
    const bare = { ...line, workspace: { sync: line.workspace?.sync } };
    const job = await jobOf(bare, inspection);
    expect(job.workspace?.changeover).toEqual([]);
    expect(job.workspace).not.toHaveProperty('timeoutMs');
  });

  it('lets a station replace the line changeover with its own block', async () => {
    const line = featureLine();
    const overridden: LineSnapshot = {
      ...line,
      stations: line.stations.map((station) =>
        station.id === 'quality-gate'
          ? {
              ...station,
              changeover: {
                timeoutMs: 120_000,
                exec: ['bun install'],
                keyFiles: ['bun.lock'],
              },
            }
          : station,
      ),
    };
    const job = await jobOf(overridden, inspection);
    expect(job.workspace).toMatchObject({
      changeover: ['bun install'],
      changeoverKeyFiles: ['bun.lock'],
      timeoutMs: 120_000,
    });
  });

  it('lets a station opt out of the line changeover with false', async () => {
    const line = featureLine();
    const optedOut: LineSnapshot = {
      ...line,
      stations: line.stations.map((station) =>
        station.id === 'quality-gate'
          ? { ...station, changeover: false }
          : station,
      ),
    };
    const job = await jobOf(optedOut, inspection);
    expect(job.workspace?.changeover).toEqual([]);
    expect(job.workspace).not.toHaveProperty('timeoutMs');
  });
});
