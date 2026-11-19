import { describe, expect, it } from 'vitest';
import {
  listWorkOrdersContract,
  transitionWorkOrderContract,
} from '../../../src/contracts/work-orders.contract';

describe('work-orders contract', () => {
  it('accepts a list query scoped to a project', () => {
    // Arrange
    const query = { projectId: 'factory', state: 'queued' };

    // Act
    const result = listWorkOrdersContract.in.query.safeParse(query);

    // Assert
    expect(result.success).toBe(true);
  });

  it('rejects a list query with an unknown state', () => {
    // Arrange
    const query = { projectId: 'factory', state: 'sleeping' };

    // Act
    const result = listWorkOrdersContract.in.query.safeParse(query);

    // Assert
    expect(result.success).toBe(false);
  });

  it('accepts a transition with a known action', () => {
    // Arrange
    const body = { action: 'resume' };

    // Act
    const result = transitionWorkOrderContract.in.body.safeParse(body);

    // Assert
    expect(result.success).toBe(true);
  });

  it('rejects a transition with an unknown key', () => {
    // Arrange
    const body = { action: 'resume', epoch: 1 };

    // Act
    const result = transitionWorkOrderContract.in.body.safeParse(body);

    // Assert
    expect(result.success).toBe(false);
  });
});
