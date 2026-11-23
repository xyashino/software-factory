import { describe, expect, it } from 'vitest';
import { transitionJobContract } from '@repo/hq-contracts/jobs.contract';

const body = transitionJobContract.in.body;

describe('jobs contract', () => {
  it('accepts a complete transition with produced files', () => {
    // Arrange
    const input = {
      action: 'complete',
      commandId: 'cmd-1',
      epoch: 1,
      producedFiles: ['.cell/build/report.md'],
    };

    // Act
    const result = body.safeParse(input);

    // Assert
    expect(result.success).toBe(true);
  });

  it('accepts a complete transition with the factory output record', () => {
    // Arrange
    const input = {
      action: 'complete',
      commandId: 'cmd-1',
      epoch: 1,
      producedFiles: [],
      output: {},
    };

    // Act
    const result = body.safeParse(input);

    // Assert
    expect(result.success).toBe(true);
  });

  it('rejects a fail transition with no detail', () => {
    // Arrange
    const input = { action: 'fail', commandId: 'cmd-1', epoch: 1 };

    // Act
    const result = body.safeParse(input);

    // Assert
    expect(result.success).toBe(false);
  });

  it('accepts a line_unavailable transition', () => {
    // Arrange
    const input = {
      action: 'line_unavailable',
      commandId: 'cmd-1',
      epoch: 1,
      lineName: 'main',
      detail: 'line file missing',
    };

    // Act
    const result = body.safeParse(input);

    // Assert
    expect(result.success).toBe(true);
  });
});
