import { describe, expect, it } from 'vitest';
import {
  assertArtifactsProduced,
  materializeLineSnapshot,
  planStepFailure,
  planWorktreeMissing,
  UnprocessableTransition,
  type OrderStep,
} from '../job-transitions';

const featureSnapshot = {
  name: 'feature',
  stations: [
    {
      id: 'plan',
      kind: 'operator',
      requiredFiles: ['plan.md'],
      maxAttempts: 2,
    },
    {
      id: 'build',
      kind: 'operator',
      requiredFiles: ['report.md', 'commit.md'],
      maxAttempts: 3,
    },
    {
      id: 'quality-gate',
      kind: 'inspection',
      requiredFiles: ['gate.json'],
      maxAttempts: 3,
      onFailRetryStationId: 'build',
    },
    {
      id: 'deliver',
      kind: 'deliver',
      requiredFiles: ['deliver.json'],
      maxAttempts: 1,
    },
  ],
};

const materialize = (): OrderStep[] => materializeLineSnapshot(featureSnapshot);

const withAttempts = (
  steps: OrderStep[],
  stepIndex: number,
  attemptsUsed: number,
): OrderStep[] =>
  steps.map((step) =>
    step.stepIndex === stepIndex ? { ...step, attemptsUsed } : step,
  );

describe('line snapshot materialization', () => {
  it('turns the stations into ordered steps with no attempts used', () => {
    const steps = materialize();

    expect(steps.map((step) => step.stationId)).toEqual([
      'plan',
      'build',
      'quality-gate',
      'deliver',
    ]);
    expect(steps.map((step) => step.stepIndex)).toEqual([0, 1, 2, 3]);
    expect(steps.every((step) => step.attemptsUsed === 0)).toBe(true);
  });

  it('keeps the rewind target on the inspection step', () => {
    const gate = materialize()[2];

    expect(gate?.onFailRetryStationId).toBe('build');
  });

  it('rejects a snapshot whose last station is not deliver', () => {
    const snapshot = {
      ...featureSnapshot,
      stations: featureSnapshot.stations.slice(0, 3),
    };

    expect(() => materializeLineSnapshot(snapshot)).toThrow(
      UnprocessableTransition,
    );
  });

  it('rejects a rewind target that is not an earlier station', () => {
    const stations = featureSnapshot.stations.map((station) =>
      station.id === 'build'
        ? { ...station, onFailRetryStationId: 'deliver' }
        : station,
    );

    expect(() =>
      materializeLineSnapshot({ ...featureSnapshot, stations }),
    ).toThrow(UnprocessableTransition);
  });

  it('rejects a rewind target that does not exist', () => {
    const stations = featureSnapshot.stations.map((station) =>
      station.id === 'quality-gate'
        ? { ...station, onFailRetryStationId: 'ghost' }
        : station,
    );

    expect(() =>
      materializeLineSnapshot({ ...featureSnapshot, stations }),
    ).toThrow(UnprocessableTransition);
  });

  it('rejects an unknown station kind', () => {
    const stations = featureSnapshot.stations.map((station) =>
      station.id === 'build' ? { ...station, kind: 'manual' } : station,
    );

    expect(() =>
      materializeLineSnapshot({ ...featureSnapshot, stations }),
    ).toThrow(UnprocessableTransition);
  });
});

describe('required files on complete', () => {
  it('accepts a step that produced every required file', () => {
    expect(() =>
      assertArtifactsProduced(
        ['report.md', 'commit.md'],
        ['commit.md', 'report.md', 'extra.log'],
      ),
    ).not.toThrow();
  });

  it('refuses a step that is missing a required file', () => {
    expect(() =>
      assertArtifactsProduced(['report.md', 'commit.md'], ['report.md']),
    ).toThrow(UnprocessableTransition);
  });
});

describe('step failure', () => {
  it('retries the same step while attempts remain', () => {
    const steps = materialize();

    expect(planStepFailure(steps, 0)).toEqual({
      attemptsUsed: 1,
      plan: { kind: 'retry', stepIndex: 0 },
    });
  });

  it('rewinds to build when the quality gate fails', () => {
    const steps = materialize();

    expect(planStepFailure(steps, 2)).toEqual({
      attemptsUsed: 1,
      plan: { kind: 'rewind', stepIndex: 1 },
    });
  });

  it('blocks with step retries exhausted when the last attempt fails', () => {
    const steps = withAttempts(materialize(), 0, 1);

    expect(planStepFailure(steps, 0)).toEqual({
      attemptsUsed: 2,
      plan: { kind: 'blocked', trigger: 'step_retries_exhausted' },
    });
  });

  it('blocks with delivery failed when the deliver step runs out of attempts', () => {
    const steps = materialize();

    expect(planStepFailure(steps, 3)).toEqual({
      attemptsUsed: 1,
      plan: { kind: 'blocked', trigger: 'delivery_failed' },
    });
  });
});

describe('worktree missing', () => {
  it('resets to a fresh step 0 on the first and second missing worktree', () => {
    expect(planWorktreeMissing(0)).toEqual({
      worktreeResets: 1,
      plan: { kind: 'reset', stepIndex: 0, workspaceMode: 'fresh' },
    });
    expect(planWorktreeMissing(1)).toEqual({
      worktreeResets: 2,
      plan: { kind: 'reset', stepIndex: 0, workspaceMode: 'fresh' },
    });
  });

  it('blocks once the reset cap is exceeded', () => {
    expect(planWorktreeMissing(2)).toEqual({
      worktreeResets: 3,
      plan: { kind: 'blocked', trigger: 'worktree_reset_limit' },
    });
  });
});
