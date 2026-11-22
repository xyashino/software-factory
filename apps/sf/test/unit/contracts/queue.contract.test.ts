import { describe, expect, it } from 'vitest';
import {
  exportQueueContract,
  importQueueContract,
  queueActionsContract,
} from '@repo/factory-contracts/queue.contract';

describe('queue contract', () => {
  it('parses a comma-separated states query into a list', () => {
    // Arrange
    const query = { projectId: 'factory', states: 'queued,paused' };

    // Act
    const result = exportQueueContract.in.query.safeParse(query);

    // Assert
    expect(result.success && result.data.states).toEqual(['queued', 'paused']);
  });

  it('rejects an export query with an unknown state', () => {
    // Arrange
    const query = { projectId: 'factory', states: 'nope' };

    // Act
    const result = exportQueueContract.in.query.safeParse(query);

    // Assert
    expect(result.success).toBe(false);
  });

  it('accepts a dry-run import without a command id', () => {
    // Arrange
    const body = {
      projectId: 'factory',
      mode: 'dry_run',
      files: [{ filename: 'a.md', markdown: '# a' }],
    };

    // Act
    const result = importQueueContract.in.body.safeParse(body);

    // Assert
    expect(result.success).toBe(true);
  });

  it('rejects an apply import without a command id', () => {
    // Arrange
    const body = { projectId: 'factory', mode: 'apply', files: [] };

    // Act
    const result = importQueueContract.in.body.safeParse(body);

    // Assert
    expect(result.success).toBe(false);
  });

  it('ignores an import body with an unknown key', () => {
    // Arrange
    const body = {
      projectId: 'factory',
      mode: 'dry_run',
      files: [],
      extra: true,
    };

    // Act
    const result = importQueueContract.in.body.safeParse(body);

    // Assert
    expect(result.success).toBe(true);
  });

  it('accepts a reprioritise action with a priority', () => {
    // Arrange
    const body = {
      action: 'reprioritise',
      orderIds: ['order-1'],
      priority: 'high',
    };

    // Act
    const result = queueActionsContract.in.body.safeParse(body);

    // Assert
    expect(result.success).toBe(true);
  });

  it('ignores a queue action with an unknown key', () => {
    // Arrange
    const body = { action: 'pause', orderIds: ['order-1'], extra: true };

    // Act
    const result = queueActionsContract.in.body.safeParse(body);

    // Assert
    expect(result.success).toBe(true);
  });
});
