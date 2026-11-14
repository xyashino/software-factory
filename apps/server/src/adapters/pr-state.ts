import type { PrState, PrStatePort } from '@repo/factory-core/ports/pr-state';
import { runProcess } from './run';

const STATES = new Set<PrState>(['open', 'merged', 'closed']);

/**
 * Pull request state through the GitHub CLI (`gh pr view --json state`). The CLI must be installed
 * and authenticated for the account that runs the server; a failure is thrown, and the PR poll
 * records nothing for that order.
 */
export const ghPrState = (): PrStatePort => ({
  read: async (prUrl) => {
    const state = (
      await runProcess([
        'gh',
        'pr',
        'view',
        prUrl,
        '--json',
        'state',
        '--jq',
        '.state',
      ])
    )
      .trim()
      .toLowerCase();
    if (!STATES.has(state as PrState)) {
      throw new Error(
        `gh reported an unknown PR state "${state}" for ${prUrl}`,
      );
    }
    return state as PrState;
  },
});
