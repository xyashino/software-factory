import { describe, expect, it } from 'vitest';
import { deliverWorkOrder } from '../../../src/application/procedures/cell/deliver.procedure';
import type { Ports } from '../../../src/application/core/procedure';
import type { PrSpec } from '../../../src/application/ports/pr.port';
import { createFakePorts } from '../../support/fake-ports';

const SPEC = {
  repoRoot: '/repo',
  worktree: '/repo/.worktrees/cli-10',
  slug: 'cli-10',
  baseBranch: 'main',
  priorStepIds: [],
};

const BODY_TEMPLATE =
  '{{objective}}\n--\n{{adrSection}}\n--\n{{verificationSection}}';

const portsWithEvents = (
  events: string[],
  pushFails = false,
  published: PrSpec[] = [],
): Ports => {
  const { ports } = createFakePorts();
  return {
    ...ports,
    fs: {
      ...ports.fs,
      readText: async (path) =>
        path.endsWith('.md') && path.includes('decisions/')
          ? '---\nsummary: Did it\nwhy: Needed\n---\n\n- bullet'
          : BODY_TEMPLATE,
    },
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
      publish: async (spec) => {
        events.push('publish');
        published.push(spec);
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

  it('publishes the objective, the inline ADR and the checks', async () => {
    // Arrange
    const published: PrSpec[] = [];
    const ports = portsWithEvents([], false, published);

    // Act
    await deliverWorkOrder(ports, {
      ...SPEC,
      taskDescription: '## 🎯 Objective\n\nShip login.\n\n## Scope\n\nx',
      adrPaths: ['decisions/a.md'],
      checks: ['pnpm ci:verify'],
    });

    // Assert
    const body = published[0]?.body ?? '';
    expect(body).toContain('Ship login.');
    expect(body).toContain('**[`decisions/a.md`](decisions/a.md)**');
    expect(body).toContain('> **Why:** Needed');
    expect(body).toContain('- [x] `pnpm ci:verify`');
    expect(body).not.toContain('Event log:');
  });

  it('says so when there is no ADR entry and no check', async () => {
    // Arrange
    const published: PrSpec[] = [];
    const ports = portsWithEvents([], false, published);

    // Act
    await deliverWorkOrder(ports, SPEC);

    // Assert
    const body = published[0]?.body ?? '';
    expect(body).toContain('_No `decisions/` entry recorded for this change._');
    expect(body).toContain('_No automated checks configured._');
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
