import { describe, expect, it } from 'vitest';
import { streamQuery } from '../../../src/contracts/stream.contract';

describe('stream contract', () => {
  it('defaults afterSeq to zero when the query omits it', () => {
    // Arrange
    const query = { projectId: 'factory' };

    // Act
    const result = streamQuery.safeParse(query);

    // Assert
    expect(result.success && result.data.afterSeq).toBe(0);
  });

  it('coerces a numeric string afterSeq into a number', () => {
    // Arrange
    const query = { afterSeq: '42' };

    // Act
    const result = streamQuery.safeParse(query);

    // Assert
    expect(result.success && result.data.afterSeq).toBe(42);
  });

  it('rejects a negative afterSeq', () => {
    // Arrange
    const query = { afterSeq: '-1' };

    // Act
    const result = streamQuery.safeParse(query);

    // Assert
    expect(result.success).toBe(false);
  });
});
