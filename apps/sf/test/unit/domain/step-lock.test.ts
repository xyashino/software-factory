import { describe, expect, it } from 'vitest';
import {
  lockVerdictOf,
  parseStepLock,
  type StepLock,
} from '../../../src/domain/cell/step-lock';

const STARTED = 'Sat Nov 21 15:29:22 2026';

const lockOf = (patch: Partial<StepLock>): StepLock => ({
  runId: 'run-1',
  pid: 4242,
  pidStartedAt: STARTED,
  pane: 'w5J:p2',
  startedAt: 1,
  ...patch,
});

describe('step lock verdict', () => {
  it('holds the step while the owner pid runs with the locked start time', () => {
    // Arrange
    const lock = lockOf({});

    // Act
    const verdict = lockVerdictOf(lock, STARTED);

    // Assert
    expect(verdict).toBe('live');
  });

  it('frees the step when the owner pid is gone', () => {
    // Arrange
    const lock = lockOf({});

    // Act
    const verdict = lockVerdictOf(lock, null);

    // Assert
    expect(verdict).toBe('stale');
  });

  it('frees the step when the pid now belongs to a process started later', () => {
    // Arrange
    const lock = lockOf({});

    // Act
    const verdict = lockVerdictOf(lock, 'Sun Nov 22 09:00:00 2026');

    // Assert
    expect(verdict).toBe('stale');
  });

  it('holds the step when the runner pid is unknown', () => {
    // Arrange
    const lock = lockOf({ pid: null, pidStartedAt: null });

    // Act
    const verdict = lockVerdictOf(lock, null);

    // Assert
    expect(verdict).toBe('live');
  });
});

describe('step lock parsing', () => {
  it('reads a lock out of runner.json next to the run mode', () => {
    // Arrange
    const record = {
      interactive: true,
      reason: '',
      ...lockOf({}),
    };

    // Act
    const lock = parseStepLock(record);

    // Assert
    expect(lock).toEqual(lockOf({}));
  });

  it('reads no lock from a runner.json written after release', () => {
    // Arrange
    const record = { interactive: true, reason: '' };

    // Act
    const lock = parseStepLock(record);

    // Assert
    expect(lock).toBeNull();
  });
});
