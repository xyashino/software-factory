import { describe, expect, it } from 'vitest';
import { listOrderPlansContract } from '@repo/hq-contracts/order-plans.contract';

describe('order-plans contract', () => {
  it('accepts a list query with a plan state filter', () => {
    // Arrange
    const query = { projectId: 'factory', state: 'active' };

    // Act
    const result = listOrderPlansContract.in.query.safeParse(query);

    // Assert
    expect(result.success).toBe(true);
  });

  it('rejects a list query without a project', () => {
    // Arrange
    const query = { state: 'active' };

    // Act
    const result = listOrderPlansContract.in.query.safeParse(query);

    // Assert
    expect(result.success).toBe(false);
  });
});
