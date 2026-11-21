import { describe, expect, it } from 'vitest';
import { commandIdOf } from '../../../src/domain/cell/command-id';

const SAMPLE = {
  cellId: 'software-factory-dev',
  orderId: 'software-factory:cli-08',
  epoch: 3,
  command: 'complete',
};

describe('command id', () => {
  it('gives the same id for a retried command', () => {
    // Arrange
    const first = commandIdOf(SAMPLE);

    // Act
    const retry = commandIdOf({ ...SAMPLE });

    // Assert
    expect(retry).toBe(first);
  });

  it('gives a new id when the epoch changes', () => {
    // Arrange
    const first = commandIdOf(SAMPLE);

    // Act
    const nextEpoch = commandIdOf({ ...SAMPLE, epoch: 4 });

    // Assert
    expect(nextEpoch).not.toBe(first);
  });

  it('gives a new id for another command on the same job', () => {
    // Arrange
    const complete = commandIdOf(SAMPLE);

    // Act
    const fail = commandIdOf({ ...SAMPLE, command: 'fail' });

    // Assert
    expect(fail).not.toBe(complete);
  });

  it('gives a sha256 hex digest', () => {
    // Arrange & Act
    const id = commandIdOf(SAMPLE);

    // Assert
    expect(id).toMatch(/^[0-9a-f]{64}$/);
  });
});
