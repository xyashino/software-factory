import { describe, expect, it } from 'vitest';
import { EXIT } from '../../../src/domain/exit-codes';

describe('exit codes', () => {
  it('uses 0 for success', () => {
    // Arrange & Act
    const code = EXIT.ok;

    // Assert
    expect(code).toBe(0);
  });

  it('uses 1 for a refused command', () => {
    // Arrange & Act
    const code = EXIT.refused;

    // Assert
    expect(code).toBe(1);
  });

  it('uses 2 for a bad argument', () => {
    // Arrange & Act
    const code = EXIT.argument;

    // Assert
    expect(code).toBe(2);
  });

  it('uses 3 for an unreachable server', () => {
    // Arrange & Act
    const code = EXIT.unreachable;

    // Assert
    expect(code).toBe(3);
  });

  it('gives every outcome its own code', () => {
    // Arrange
    const codes = Object.values(EXIT);

    // Act
    const distinct = new Set(codes);

    // Assert
    expect(distinct.size).toBe(codes.length);
  });
});
