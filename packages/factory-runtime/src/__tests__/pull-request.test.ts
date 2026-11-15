import { describe, expect, it } from 'vitest';
import { world } from './test-kit';

const PR_URL = 'https://example.test/software-factory/pull/9';

describe('pull request state from GitHub (CORE §5.2, §12.3)', () => {
  it('records nothing for a pull request that no Work order or plan holds', async () => {
    const w = world();

    const recorded = await w.runtime.recordPullRequest({
      deliveryId: 'delivery-stray',
      prUrl: PR_URL,
      state: 'merged',
    });

    expect(recorded).toBe(0);
    expect(await w.events.plans()).toEqual([]);
  });
});
