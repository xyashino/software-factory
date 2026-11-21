import { describe, expect, it } from 'vitest';
import { EXIT } from '../../../src/domain/exit-codes';

describe('exit codes', () => {
  it('exits 0 on success', () => {
    // Arrange & Act
    const code = EXIT.ok;

    // Assert
    expect(code).toBe(0);
  });

  it('exits 1 when the command is refused', () => {
    // Arrange & Act
    const code = EXIT.refused;

    // Assert
    expect(code).toBe(1);
  });

  it('exits 2 on a bad argument', () => {
    // Arrange & Act
    const code = EXIT.argument;

    // Assert
    expect(code).toBe(2);
  });

  it('exits 3 when the server is unreachable', () => {
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
