import { describe, expect, it } from 'vitest';
import { CLAIM_WAIT_MS } from '../../../src/config';
import { heartbeatVerdict, nextStep } from '../../../src/domain/cell/cell-loop';

describe('cell loop policy', () => {
  it('claims again with the long-poll wait after an empty reply', () => {
    // Arrange & Act
    const step = nextStep(null);

    // Assert
    expect(step).toEqual({ kind: 'claim', waitMs: CLAIM_WAIT_MS });
  });

  it('runs the inline next job without claiming', () => {
    // Arrange
    const job = { jobId: 'job-2' };

    // Act
    const step = nextStep(job);

    // Assert
    expect(step).toEqual({ kind: 'run', job });
  });

  it('keeps the runner while heartbeats succeed', () => {
    // Arrange & Act
    const verdict = heartbeatVerdict(0, []);

    // Assert
    expect(verdict).toBe('continue');
  });

  it('keeps the runner after three failed heartbeats', () => {
    // Arrange & Act
    const verdict = heartbeatVerdict(3, []);

    // Assert
    expect(verdict).toBe('continue');
  });

  it('aborts the runner after four failed heartbeats', () => {
    // Arrange & Act
    const verdict = heartbeatVerdict(4, []);

    // Assert
    expect(verdict).toBe('abort');
  });

  it('aborts the runner when the server signals abort', () => {
    // Arrange & Act
    const verdict = heartbeatVerdict(0, ['abort']);

    // Assert
    expect(verdict).toBe('abort');
  });
});
