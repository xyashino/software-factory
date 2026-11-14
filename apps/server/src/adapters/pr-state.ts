import type {
  PrForBranch,
  PrState,
  PrStatePort,
} from '@repo/factory-core/ports/pr-state';
import { runProcess } from './run';

const STATES = new Set<PrState>(['open', 'merged', 'closed']);

/** `owner/repo` for a GitHub URL; any other repository is passed to `gh` as it is. */
const repoOf = (repoUrl: string): string => {
  const match = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(repoUrl);
  return match?.[1] ?? repoUrl;
};

/**
 * Pull request state through the GitHub CLI (`gh pr view --json state`). The CLI must be installed
 * and authenticated for the account that runs the server; a failure is thrown, and the PR poll
 * records nothing for that order.
 */
export const ghPrState = (): PrStatePort => ({
  forBranch: async (repoUrl, branch): Promise<PrForBranch | undefined> => {
    const listed = await runProcess([
      'gh',
      'pr',
      'list',
      '--repo',
      repoOf(repoUrl),
      '--head',
      branch,
      '--state',
      'all',
      '--json',
      'url,state',
    ]);
    const found: PrForBranch[] = (
      JSON.parse(listed) as { url: string; state: string }[]
    ).flatMap((pr) => {
      const state = pr.state.toLowerCase();
      return STATES.has(state as PrState)
        ? [{ prUrl: pr.url, state: state as PrState }]
        : [];
    });
    return found.find((pr) => pr.state === 'open') ?? found[0];
  },
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
