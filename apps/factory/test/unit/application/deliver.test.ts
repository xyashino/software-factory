import { describe, expect, it } from 'vitest';
import { deliverWorkOrder } from '../../../src/application/procedures/cell/deliver.procedure';
import type { Ports } from '../../../src/application/core/procedure';
import { createFakePorts } from '../../support/fake-ports';

const SPEC = {
  repoRoot: '/repo',
  worktree: '/repo/.worktrees/cli-10',
  slug: 'cli-10',
  baseBranch: 'main',
  priorStepIds: [],
};

const portsWithEvents = (events: string[], pushFails = false): Ports => {
  const { ports } = createFakePorts();
  return {
    ...ports,
    fs: { ...ports.fs, readText: async () => '{{objective}}' },
    git: {
      ...ports.git,
      push: async () => {
        events.push('push');
        if (pushFails) {
          throw new Error('remote rejected');
        }
      },
      headSha: async () => 'abc123',
      worktreeRemove: async () => {
        events.push('remove');
      },
    },
    pr: {
      publish: async () => {
        events.push('publish');
      },
    },
  };
};

describe('deliver', () => {
  it('pushes the branch and publishes before removing the worktree', async () => {
    // Arrange
    const events: string[] = [];
    const ports = portsWithEvents(events);

    // Act
    const commitSha = await deliverWorkOrder(ports, SPEC);

    // Assert
    expect(events).toEqual(['push', 'publish', 'remove']);
    expect(commitSha).toBe('abc123');
  });

  it('keeps the worktree when the push fails', async () => {
    // Arrange
    const events: string[] = [];
    const ports = portsWithEvents(events, true);

    // Act
    const delivery = deliverWorkOrder(ports, SPEC);

    // Assert
    await expect(delivery).rejects.toThrow('remote rejected');
    expect(events).toEqual(['push']);
  });
});
